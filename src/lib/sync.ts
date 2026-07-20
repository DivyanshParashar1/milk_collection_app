// ============================================================================
// Sync engine — pushes locally-created rows (synced = 0) up to Supabase, then
// marks them synced. This is the clean equivalent of the original app's
// `syncdata-new` delta upload, but over Supabase's REST/PostgREST API.
// ============================================================================
import { supabase } from './supabase';
import {
  unsyncedMembers,
  unsyncedCollections,
  unsyncedPayouts,
  unsyncedLedgerEntries,
  unsyncedLocalSales,
  unsyncedUnionSales,
  unsyncedRoutineCustomers,
  unsyncedRoutineDeliveries,
  unsyncedRoutinePayments,
  markMemberSynced,
  markCollectionSynced,
  markPayoutSynced,
  markLedgerSynced,
  markLocalSaleSynced,
  markUnionSaleSynced,
  markRoutineCustomerSynced,
  markRoutineDeliverySynced,
  markRoutinePaymentSynced,
  pendingDeliveryDeletions,
  clearDeliveryDeletion,
  upsertRoutineCustomerFromServer,
  upsertRoutineDeliveryFromServer,
  upsertRoutinePaymentFromServer,
  updateCollectionLocal,
  deleteCollectionLocal,
  CollectionValues,
  getRateChart,
  setRateChart,
  upsertMemberFromServer,
  upsertCollectionFromServer,
  upsertPayoutFromServer,
  upsertLedgerFromServer,
  upsertLocalSaleFromServer,
  upsertUnionSaleFromServer,
  withTransaction,
} from './db';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSettings, saveSettings } from './settings';
import { refreshLock } from './subscription';

export type SyncResult = {
  pushedMembers: number;
  pushedCollections: number;
  pushedPayouts: number;
  pushedLedger: number;
  pushedLocalSales: number;
  pushedUnionSales: number;
  pushedRoutineCustomers: number;
  pushedRoutineDeliveries: number;
  pushedRoutinePayments: number;
  pulled: number;
  error?: string;
};

// The society id never changes for a signed-in user, but pushAll + pullAll each
// used to re-fetch it, and via getUser() — which is a network call. getSession()
// reads the cached session locally, and the profile lookup is memoised, so a
// full sync now spends one request on this instead of four.
let societyCache: { userId: string; societyId: string } | null = null;

export function clearSocietyCache(): void {
  societyCache = null;
}

async function currentSocietyId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  if (societyCache?.userId === userId) return societyCache.societyId;

  const { data: profile } = await supabase
    .from('profiles')
    .select('society_id')
    .eq('id', userId)
    .single();
  const societyId = profile?.society_id ?? null;
  if (societyId) societyCache = { userId, societyId };
  return societyId;
}

// PostgREST accepts an array body, so a table syncs in one request instead of
// one per row. Chunked to keep any single request a sane size.
const PUSH_CHUNK = 500;

async function pushTable<T extends { local_id: number; client_id: string }>(
  table: string,
  onConflict: string,
  rows: T[],
  toPayload: (row: T) => Record<string, unknown>,
  mark: (localId: number, remoteId: string) => Promise<void>
): Promise<{ pushed: number; error?: string }> {
  if (!rows.length) return { pushed: 0 };
  let pushed = 0;

  for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
    const chunk = rows.slice(i, i + PUSH_CHUNK);
    const { data, error } = await supabase
      .from(table)
      .upsert(chunk.map(toPayload), { onConflict, ignoreDuplicates: false })
      .select('id, client_id');
    if (error) return { pushed, error: error.message };

    // Every payload carries client_id, so the returned rows map back to local
    // rows by it — including members, whose conflict target is membercode.
    const remoteIdByClientId = new Map<string, string>(
      (data ?? []).map((d: any) => [d.client_id, d.id])
    );
    await withTransaction(async () => {
      for (const row of chunk) {
        const remoteId = remoteIdByClientId.get(row.client_id);
        if (remoteId) {
          await mark(row.local_id, remoteId);
          pushed++;
        }
      }
    });
  }
  return { pushed };
}

export async function pushAll(): Promise<SyncResult> {
  const societyId = await currentSocietyId();
  const empty: SyncResult = {
    pushedMembers: 0, pushedCollections: 0, pushedPayouts: 0, pushedLedger: 0,
    pushedLocalSales: 0, pushedUnionSales: 0, pushedRoutineCustomers: 0,
    pushedRoutineDeliveries: 0, pushedRoutinePayments: 0, pulled: 0,
  };
  if (!societyId) return { ...empty, error: 'Not signed in / no society set' };

  const result: SyncResult = { ...empty };

  // Members and routine customers go first, and together: everything below
  // points at one or the other, so the server has to know them before rows
  // referencing them arrive. They don't reference each other, so one round
  // trip covers both.
  const [members, routineCustomers] = await Promise.all([
    pushTable(
      'members', 'society_id,membercode', await unsyncedMembers(),
      (m) => ({
        client_id: m.client_id, society_id: societyId, membercode: m.membercode,
        name: m.name, name_local: m.name_local, mobile1: m.mobile1,
        animal_type: m.animal_type, upi_id: m.upi_id, bank_account: m.bank_account,
        ifsc_code: m.ifsc_code, fix_deduction: m.fix_deduction,
      }),
      markMemberSynced
    ),
    pushTable(
      'routine_customers', 'society_id,client_id', await unsyncedRoutineCustomers(),
      (c) => ({
        client_id: c.client_id, society_id: societyId, name: c.name,
        mobile: c.mobile, address: c.address, milk_type: c.milk_type, rate: c.rate,
        am_active: !!c.am_active, am_qty: c.am_qty,
        pm_active: !!c.pm_active, pm_qty: c.pm_qty,
        active: !!c.active,
      }),
      markRoutineCustomerSynced
    ),
  ]);
  result.pushedMembers = members.pushed;
  result.pushedRoutineCustomers = routineCustomers.pushed;
  if (members.error) return { ...result, error: members.error };
  if (routineCustomers.error) return { ...result, error: routineCustomers.error };

  // The remaining tables only depend on the two above, never on each other, so
  // they go out together — the same fix pullAll already had. Serially they cost
  // a round-trip each, which on a rural link is most of the wait.
  const [cols, payouts, ledger, localSales, unionSales, deliveries, routinePayments] = await Promise.all([
    pushTable(
      'milk_collections', 'society_id,client_id', await unsyncedCollections(),
      (c) => ({
        client_id: c.client_id, society_id: societyId, membercode: c.membercode,
        session: c.session, collect_date: c.collect_date, weight: c.weight,
        fat: c.fat, snf: c.snf, clr: c.clr, rate: c.rate, price: c.price,
        kg_fat: c.kg_fat, kg_snf: c.kg_snf, deduction: c.deduction,
        pay_price: c.pay_price, animal_type: c.animal_type,
      }),
      markCollectionSynced
    ),
    pushTable(
      'payouts', 'society_id,client_id', await unsyncedPayouts(),
      (p) => ({
        client_id: p.client_id, society_id: societyId, membercode: p.membercode,
        amount: p.amount, method: p.method, upi_ref: p.upi_ref, note: p.note,
      }),
      markPayoutSynced
    ),
    pushTable(
      'ledger_entries', 'society_id,client_id', await unsyncedLedgerEntries(),
      (le) => ({
        client_id: le.client_id, society_id: societyId, membercode: le.membercode,
        amount: le.amount, kind: le.kind, note: le.note, entry_date: le.entry_date,
      }),
      markLedgerSynced
    ),
    pushTable(
      'local_sales', 'society_id,client_id', await unsyncedLocalSales(),
      (s) => ({
        client_id: s.client_id, society_id: societyId, customer_name: s.customer_name,
        quantity: s.quantity, rate: s.rate, amount: s.amount,
        milk_type: s.milk_type, sale_date: s.sale_date,
      }),
      markLocalSaleSynced
    ),
    pushTable(
      'union_sales', 'society_id,client_id', await unsyncedUnionSales(),
      (u) => ({
        client_id: u.client_id, society_id: societyId, sale_date: u.sale_date,
        session: u.session, quantity: u.quantity, fat: u.fat, snf: u.snf,
        rate: u.rate, amount: u.amount, kg_fat: u.kg_fat, kg_snf: u.kg_snf,
        union_name: u.union_name, note: u.note,
        rate_basis: u.rate_basis ?? 'litre', fat_rate: u.fat_rate ?? 0,
      }),
      markUnionSaleSynced
    ),
    // customer_remote_id comes from the join in unsyncedRoutineDeliveries():
    // rows whose customer hasn't reached the server yet are excluded there and
    // picked up on the next sync, once the push above has given them an id.
    //
    // Conflict target is the natural key, NOT client_id: a delivery is one
    // customer on one date in one session, and two devices saving that same
    // day generate two different client_ids. On client_id the second push
    // would hit the (customer_id, delivery_date, session) constraint and fail
    // forever. On the natural key it updates the existing row — and since the
    // payload carries client_id, the response comes back with the new one, so
    // pushTable can still map it home.
    pushTable(
      'routine_deliveries', 'customer_id,delivery_date,session', await unsyncedRoutineDeliveries(),
      (d) => ({
        client_id: d.client_id, society_id: societyId,
        customer_id: d.customer_remote_id,
        delivery_date: d.delivery_date, session: d.session,
        quantity: d.quantity, rate: d.rate, amount: d.amount,
      }),
      markRoutineDeliverySynced
    ),
    pushTable(
      'routine_payments', 'society_id,client_id', await unsyncedRoutinePayments(),
      (p) => ({
        client_id: p.client_id, society_id: societyId,
        customer_id: p.customer_remote_id,
        amount: p.amount, method: p.method, note: p.note, paid_on: p.paid_on,
      }),
      markRoutinePaymentSynced
    ),
  ]);

  result.pushedCollections = cols.pushed;
  result.pushedPayouts = payouts.pushed;
  result.pushedLedger = ledger.pushed;
  result.pushedLocalSales = localSales.pushed;
  result.pushedUnionSales = unionSales.pushed;
  result.pushedRoutineDeliveries = deliveries.pushed;
  result.pushedRoutinePayments = routinePayments.pushed;

  // Unticking a delivery deletes it locally; the server copy has to go too, or
  // the next pull would bring the charge straight back.
  await pushDeliveryDeletions();

  // Rows that did push stay marked synced; report the first failure so the next
  // run retries only what's still dirty.
  const failed = [cols, payouts, ledger, localSales, unionSales, deliveries, routinePayments].find((r) => r.error);
  if (failed?.error) return { ...result, error: failed.error };

  return result;
}

/**
 * Delete server rows for deliveries that were unticked while offline.
 *
 * The queue entry is only cleared once the server confirms, so a failure here
 * just means the deletion is retried on the next sync rather than being lost.
 */
async function pushDeliveryDeletions(): Promise<void> {
  const ids = await pendingDeliveryDeletions();
  if (!ids.length) return;
  const { error } = await supabase.from('routine_deliveries').delete().in('id', ids);
  if (error) return;
  for (const id of ids) await clearDeliveryDeletion(id);
}

// --- Edit / delete a collection, keeping local + server consistent ---------
// If the row was already synced (has remote_id), the server row must be
// updated/deleted too; if that network call fails we DON'T touch local, so
// the two never diverge. Unsynced rows are purely local.

export async function saveCollectionEdit(row: any, c: CollectionValues): Promise<{ error?: string }> {
  if (row.remote_id) {
    const { error } = await supabase
      .from('milk_collections')
      .update({
        weight: c.weight, fat: c.fat, snf: c.snf, rate: c.rate, price: c.price,
        kg_fat: c.kg_fat, kg_snf: c.kg_snf, deduction: c.deduction, pay_price: c.pay_price,
      })
      .eq('id', row.remote_id);
    if (error) return { error: 'Online needed to edit a synced entry: ' + error.message };
  }
  await updateCollectionLocal(row.local_id, c);
  return {};
}

export async function deleteCollection(row: any): Promise<{ error?: string }> {
  if (row.remote_id) {
    const { error } = await supabase.from('milk_collections').delete().eq('id', row.remote_id);
    if (error) return { error: 'Online needed to delete a synced entry: ' + error.message };
  }
  await deleteCollectionLocal(row.local_id);
  return {};
}

// --- Rate chart cloud backup / restore -------------------------------------
async function defaultChartId(societyId: string): Promise<string | null> {
  const { data } = await supabase
    .from('rate_charts')
    .select('id')
    .eq('society_id', societyId)
    .eq('name', 'Default')
    .maybeSingle();
  return data?.id ?? null;
}

export async function backupRateChart(): Promise<{ error?: string; count?: number }> {
  const societyId = await currentSocietyId();
  if (!societyId) return { error: 'Not signed in / no society set' };
  const entries = await getRateChart();

  let chartId = await defaultChartId(societyId);
  if (!chartId) {
    const { data, error } = await supabase
      .from('rate_charts')
      .insert({ society_id: societyId, name: 'Default', method: 'fat' })
      .select('id')
      .single();
    if (error) return { error: error.message };
    chartId = data.id;
  }

  await supabase.from('rate_chart_entries').delete().eq('chart_id', chartId);
  if (entries.length) {
    const { error } = await supabase
      .from('rate_chart_entries')
      .insert(entries.map((e) => ({ chart_id: chartId, fat: e.fat, snf: e.snf ?? null, rate: e.rate })));
    if (error) return { error: error.message };
  }
  return { count: entries.length };
}

export async function restoreRateChart(): Promise<{ error?: string; count?: number }> {
  const societyId = await currentSocietyId();
  if (!societyId) return { error: 'Not signed in / no society set' };
  const chartId = await defaultChartId(societyId);
  if (!chartId) return { error: 'No rate chart backup found in the cloud' };
  const { data, error } = await supabase
    .from('rate_chart_entries')
    .select('fat, snf, rate')
    .eq('chart_id', chartId)
    .order('fat');
  if (error) return { error: error.message };
  await setRateChart((data ?? []).map((e: any) => ({ fat: e.fat, snf: e.snf, rate: e.rate })));
  return { count: data?.length ?? 0 };
}

// ============================================================================
// Pull sync — download rows from Supabase that we don't have locally.
// ============================================================================

const LAST_PULL_KEY = 'sync:lastPullAt';

export async function pullAll(): Promise<{ pulled: number; error?: string }> {
  const societyId = await currentSocietyId();
  if (!societyId) return { pulled: 0, error: 'Not signed in / no society set' };

  const lastPull = (await AsyncStorage.getItem(LAST_PULL_KEY)) ?? '1970-01-01T00:00:00Z';

  try {
    // Every table is paged on `updated_at`, never `created_at`: payouts has no
    // created_at column (its timestamp is paid_at), so asking for one made
    // PostgREST reject that query — and since one failure fails the whole pull,
    // pullAll returned 0 rows on every run. updated_at exists on all six
    // (migration v5/v6) and is the only column that also reflects edits.
    //
    // All seven queries go out together. They are independent, so paying for
    // seven serial round-trips on a rural connection was most of the wait.
    const since = (table: string) =>
      supabase.from(table).select('*').eq('society_id', societyId).gt('updated_at', lastPull).order('updated_at');

    const [soc, members, cols, payouts, ledger, lSales, uSales, rCustomers, rDeliveries, rPayments] = await Promise.all([
      supabase.from('societies').select('subscription_end_date, is_active').eq('id', societyId).single(),
      since('members'),
      since('milk_collections'),
      since('payouts'),
      since('ledger_entries'),
      since('local_sales'),
      since('union_sales'),
      since('routine_customers'),
      since('routine_deliveries'),
      since('routine_payments'),
    ]);

    const failed = [members, cols, payouts, ledger, lSales, uSales, rCustomers, rDeliveries, rPayments].find((r) => r.error);
    if (failed?.error) return { pulled: 0, error: failed.error.message };

    // Subscription status drives the write lock, so refresh it immediately —
    // this is how a renewal reaches a locked device.
    if (soc.data) {
      const s = await getSettings();
      // A never-subscribed society has a null end date (migration v8 — no trial).
      // Coerce to '' so settings stays the string it is typed as; computeLocked
      // reads both as "no subscription" and locks.
      await saveSettings({
        ...s,
        subscriptionEnd: soc.data.subscription_end_date ?? '',
        isActive: soc.data.is_active,
      });
      await refreshLock();
    }

    // One transaction for the whole pull rather than one commit per row.
    let pulled = 0;
    await withTransaction(async () => {
      for (const m of members.data ?? []) { await upsertMemberFromServer(m); pulled++; }
      for (const c of cols.data ?? []) { await upsertCollectionFromServer(c); pulled++; }
      for (const p of payouts.data ?? []) { await upsertPayoutFromServer(p); pulled++; }
      for (const l of ledger.data ?? []) { await upsertLedgerFromServer(l); pulled++; }
      for (const s of lSales.data ?? []) { await upsertLocalSaleFromServer(s); pulled++; }
      for (const u of uSales.data ?? []) { await upsertUnionSaleFromServer(u); pulled++; }
      // Customers before their deliveries and payments — those resolve the
      // customer by remote_id and skip rows they cannot match.
      for (const c of rCustomers.data ?? []) { await upsertRoutineCustomerFromServer(c); pulled++; }
      for (const d of rDeliveries.data ?? []) { await upsertRoutineDeliveryFromServer(d); pulled++; }
      for (const p of rPayments.data ?? []) { await upsertRoutinePaymentFromServer(p); pulled++; }
    });

    await AsyncStorage.setItem(LAST_PULL_KEY, new Date().toISOString());
    return { pulled };
  } catch (err: any) {
    return { pulled: 0, error: err?.message ?? String(err) };
  }
}
