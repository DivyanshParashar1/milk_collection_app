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
  markMemberSynced,
  markCollectionSynced,
  markPayoutSynced,
  markLedgerSynced,
  markLocalSaleSynced,
  markUnionSaleSynced,
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
} from './db';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SyncResult = {
  pushedMembers: number;
  pushedCollections: number;
  pushedPayouts: number;
  pushedLedger: number;
  pushedLocalSales: number;
  pushedUnionSales: number;
  pulled: number;
  error?: string;
};

async function currentSocietyId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('society_id')
    .eq('id', userData.user.id)
    .single();
  return data?.society_id ?? null;
}

export async function pushAll(): Promise<SyncResult> {
  const societyId = await currentSocietyId();
  const empty: SyncResult = { pushedMembers: 0, pushedCollections: 0, pushedPayouts: 0, pushedLedger: 0, pushedLocalSales: 0, pushedUnionSales: 0, pulled: 0 };
  if (!societyId)
    return { ...empty, error: 'Not signed in / no society set' };

  let pushedMembers = 0;
  let pushedCollections = 0;
  let pushedPayouts = 0;
  let pushedLedger = 0;
  let pushedLocalSales = 0;
  let pushedUnionSales = 0;

  // --- members ---
  const members = await unsyncedMembers();
  for (const m of members) {
    const { data, error } = await supabase
      .from('members')
      .upsert(
        {
          society_id: societyId,
          membercode: m.membercode,
          name: m.name,
          name_local: m.name_local,
          mobile1: m.mobile1,
          animal_type: m.animal_type,
          upi_id: m.upi_id,
          bank_account: m.bank_account,
          ifsc_code: m.ifsc_code,
          fix_deduction: m.fix_deduction,
        },
        { onConflict: 'society_id,membercode' }
      )
      .select('id')
      .single();
    if (error) return { ...empty, pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, pushedUnionSales, error: error.message };
    await markMemberSynced(m.local_id, data.id);
    pushedMembers++;
  }

  // --- milk collections ---
  const cols = await unsyncedCollections();
  for (const c of cols) {
    const { data, error } = await supabase
      .from('milk_collections')
      .insert({
        society_id: societyId,
        membercode: c.membercode,
        session: c.session,
        collect_date: c.collect_date,
        weight: c.weight,
        fat: c.fat,
        snf: c.snf,
        clr: c.clr,
        rate: c.rate,
        price: c.price,
        kg_fat: c.kg_fat,
        kg_snf: c.kg_snf,
        deduction: c.deduction,
        pay_price: c.pay_price,
        animal_type: c.animal_type,
      })
      .select('id')
      .single();
    if (error) return { ...empty, pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, pushedUnionSales, error: error.message };
    await markCollectionSynced(c.local_id, data.id);
    pushedCollections++;
  }

  // --- payouts (cash / upi) ---
  const payouts = await unsyncedPayouts();
  for (const p of payouts) {
    const { data, error } = await supabase
      .from('payouts')
      .insert({
        society_id: societyId,
        membercode: p.membercode,
        amount: p.amount,
        method: p.method,
        upi_ref: p.upi_ref,
        note: p.note,
      })
      .select('id')
      .single();
    if (error) return { ...empty, pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, pushedUnionSales, error: error.message };
    await markPayoutSynced(p.local_id, data.id);
    pushedPayouts++;
  }

  // --- ledger entries (jama / udhar) ---
  const ledger = await unsyncedLedgerEntries();
  for (const le of ledger) {
    const { data, error } = await supabase
      .from('ledger_entries')
      .insert({
        society_id: societyId,
        membercode: le.membercode,
        amount: le.amount,
        kind: le.kind,
        note: le.note,
        entry_date: le.entry_date,
      })
      .select('id')
      .single();
    if (error) return { ...empty, pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, pushedUnionSales, error: error.message };
    await markLedgerSynced(le.local_id, data.id);
    pushedLedger++;
  }

  // --- local sales ---
  const sales = await unsyncedLocalSales();
  for (const s of sales) {
    const { data, error } = await supabase
      .from('local_sales')
      .insert({
        society_id: societyId,
        customer_name: s.customer_name,
        quantity: s.quantity,
        rate: s.rate,
        amount: s.amount,
        milk_type: s.milk_type,
        sale_date: s.sale_date,
      })
      .select('id')
      .single();
    if (error) return { ...empty, pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, pushedUnionSales, error: error.message };
    await markLocalSaleSynced(s.local_id, data.id);
    pushedLocalSales++;
  }

  // --- union sales ---
  const uSales = await unsyncedUnionSales();
  for (const u of uSales) {
    const { data, error } = await supabase
      .from('union_sales')
      .insert({
        society_id: societyId,
        sale_date: u.sale_date,
        session: u.session,
        quantity: u.quantity,
        fat: u.fat,
        snf: u.snf,
        rate: u.rate,
        amount: u.amount,
        kg_fat: u.kg_fat,
        kg_snf: u.kg_snf,
        union_name: u.union_name,
        note: u.note,
      })
      .select('id')
      .single();
    if (error) return { ...empty, pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, pushedUnionSales, error: error.message };
    await markUnionSaleSynced(u.local_id, data.id);
    pushedUnionSales++;
  }

  return { pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, pushedUnionSales, pulled: 0 };
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
  let pulled = 0;

  try {
    // --- members ---
    const { data: members, error: e1 } = await supabase
      .from('members')
      .select('*')
      .eq('society_id', societyId)
      .gt('created_at', lastPull)
      .order('created_at');
    if (e1) return { pulled, error: e1.message };
    for (const m of members ?? []) { await upsertMemberFromServer(m); pulled++; }

    // --- collections ---
    const { data: cols, error: e2 } = await supabase
      .from('milk_collections')
      .select('*')
      .eq('society_id', societyId)
      .gt('created_at', lastPull)
      .order('created_at');
    if (e2) return { pulled, error: e2.message };
    for (const c of cols ?? []) { await upsertCollectionFromServer(c); pulled++; }

    // --- payouts ---
    const { data: payouts, error: e3 } = await supabase
      .from('payouts')
      .select('*')
      .eq('society_id', societyId)
      .gt('created_at', lastPull)
      .order('created_at');
    if (e3) return { pulled, error: e3.message };
    for (const p of payouts ?? []) { await upsertPayoutFromServer(p); pulled++; }

    // --- ledger ---
    const { data: ledger, error: e4 } = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('society_id', societyId)
      .gt('created_at', lastPull)
      .order('created_at');
    if (e4) return { pulled, error: e4.message };
    for (const l of ledger ?? []) { await upsertLedgerFromServer(l); pulled++; }

    // --- local sales ---
    const { data: lSales, error: e5 } = await supabase
      .from('local_sales')
      .select('*')
      .eq('society_id', societyId)
      .gt('created_at', lastPull)
      .order('created_at');
    if (e5) return { pulled, error: e5.message };
    for (const s of lSales ?? []) { await upsertLocalSaleFromServer(s); pulled++; }

    // --- union sales ---
    const { data: uSales, error: e6 } = await supabase
      .from('union_sales')
      .select('*')
      .eq('society_id', societyId)
      .gt('created_at', lastPull)
      .order('created_at');
    if (e6) return { pulled, error: e6.message };
    for (const u of uSales ?? []) { await upsertUnionSaleFromServer(u); pulled++; }

    // update timestamp
    await AsyncStorage.setItem(LAST_PULL_KEY, new Date().toISOString());
    return { pulled };
  } catch (err: any) {
    return { pulled, error: err?.message ?? String(err) };
  }
}
