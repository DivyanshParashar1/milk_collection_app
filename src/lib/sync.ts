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
  markMemberSynced,
  markCollectionSynced,
  markPayoutSynced,
  markLedgerSynced,
  markLocalSaleSynced,
  updateCollectionLocal,
  deleteCollectionLocal,
  CollectionValues,
  getRateChart,
  setRateChart,
} from './db';

export type SyncResult = {
  pushedMembers: number;
  pushedCollections: number;
  pushedPayouts: number;
  pushedLedger: number;
  pushedLocalSales: number;
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
  if (!societyId)
    return { pushedMembers: 0, pushedCollections: 0, pushedPayouts: 0, pushedLedger: 0, pushedLocalSales: 0, error: 'Not signed in / no society set' };

  let pushedMembers = 0;
  let pushedCollections = 0;
  let pushedPayouts = 0;
  let pushedLedger = 0;
  let pushedLocalSales = 0;

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
    if (error) return { pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, error: error.message };
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
    if (error) return { pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, error: error.message };
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
    if (error) return { pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, error: error.message };
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
    if (error) return { pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, error: error.message };
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
    if (error) return { pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales, error: error.message };
    await markLocalSaleSynced(s.local_id, data.id);
    pushedLocalSales++;
  }

  return { pushedMembers, pushedCollections, pushedPayouts, pushedLedger, pushedLocalSales };
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
