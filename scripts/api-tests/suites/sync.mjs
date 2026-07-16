// ============================================================================
// Sync semantics — the exact PostgREST calls sync.ts makes.
//
// These mirror pushAll/pullAll rather than testing tables in the abstract,
// because the interesting failures live in the details: the onConflict target,
// the `client_id` round-trip that maps remote ids back to local rows, and the
// `updated_at` cursor.
//
// The `.gt('updated_at', …)` tests are regression tests. sync.ts documents a
// bug where pullAll paged on `created_at`, which payouts does not have — one
// rejected query failed the whole pull, so pullAll returned 0 rows on every
// run. These assert the column exists and is filterable on ALL six tables.
// ============================================================================
import { admin, signedInAs } from '../lib/clients.mjs';
import { suite, test, ok, eq, expectOk, expectAnyError } from '../lib/harness.mjs';
import { randomUUID } from 'node:crypto';

const PULLED_TABLES = ['members', 'milk_collections', 'payouts', 'ledger_entries', 'local_sales', 'union_sales'];

export default async function syncSuite(fx) {
  suite('Sync · pull cursor');

  const { client: A } = await signedInAs(fx.userA.email, fx.password);
  const today = new Date().toISOString().slice(0, 10);
  const trash = [];
  const track = (t, id) => { if (id) trash.push([t, id]); };

  for (const table of PULLED_TABLES) {
    await test(`${table} is filterable on updated_at (pullAll cursor)`, async () => {
      // Exactly the query `since()` builds in pullAll.
      const r = await A.from(table).select('*').eq('society_id', fx.societyA.id).gt('updated_at', '1970-01-01T00:00:00Z').order('updated_at');
      if (r.error) throw new Error(`pullAll would fail on ${table}: ${r.error.code} ${r.error.message}`);
      return `ok (${r.data.length} rows)`;
    });
  }

  await test('REGRESSION: payouts has no created_at — the old cursor would 42703', async () => {
    // Pinning the original bug: if someone reintroduces created_at paging,
    // this passes loudly and points at why the pull silently returned nothing.
    const r = await A.from('payouts').select('*').gt('created_at', '1970-01-01T00:00:00Z');
    if (!r.error) return 'payouts NOW has created_at — the old bug would no longer reproduce';
    eq(r.error.code, '42703', 'expected unknown-column');
    return `confirmed: ${r.error.message}`;
  });

  await test('one bad table in the Promise.all fails the whole pull', async () => {
    // Documents the blast radius: pullAll fails closed on the first error, so a
    // single rejected query means 0 rows pulled, not partial progress.
    const results = await Promise.all([
      A.from('members').select('*').eq('society_id', fx.societyA.id).gt('updated_at', '1970-01-01T00:00:00Z'),
      A.from('payouts').select('*').eq('society_id', fx.societyA.id).gt('no_such_col', '1970-01-01T00:00:00Z'),
    ]);
    const failed = results.find((r) => r.error);
    ok(failed, 'expected the bad query to fail');
    return `first error wins → pulled=0 (${failed.error.code})`;
  });

  await test('updated_at advances on UPDATE (the trigger fires)', async () => {
    // If set_updated_at() is missing, edits never come down on the next pull:
    // the cursor skips them and two devices silently diverge.
    const { data: row } = await admin.from('members')
      .insert({ society_id: fx.societyA.id, membercode: 601, name: 'Trigger probe' })
      .select('id, updated_at').single();
    track('members', row.id);
    const before = row.updated_at;
    await new Promise((r) => setTimeout(r, 1100)); // clear timestamp resolution
    const { data: after } = await admin.from('members').update({ name: 'Trigger probe 2' }).eq('id', row.id).select('updated_at').single();
    ok(new Date(after.updated_at) > new Date(before), `updated_at did NOT advance (${before} → ${after.updated_at}) — edits will never sync`);
    return `${before} → ${after.updated_at}`;
  });

  // ------------------------------------------------------------------- upserts
  suite('Sync · push idempotency');

  await test('members upsert on (society_id, membercode) is idempotent', async () => {
    const clientId = randomUUID();
    const payload = { client_id: clientId, society_id: fx.societyA.id, membercode: 700, name: 'Upsert probe', mobile1: '9999999999' };
    const first = expectOk(await A.from('members').upsert(payload, { onConflict: 'society_id,membercode', ignoreDuplicates: false }).select('id, client_id'), 'first upsert');
    const second = expectOk(await A.from('members').upsert({ ...payload, name: 'Upsert probe EDITED' }, { onConflict: 'society_id,membercode', ignoreDuplicates: false }).select('id, client_id'), 'second upsert');
    track('members', first[0].id);

    eq(first[0].id, second[0].id, 'the second push created a DUPLICATE farmer instead of updating');
    const { count } = await admin.from('members').select('*', { count: 'exact', head: true }).eq('society_id', fx.societyA.id).eq('membercode', 700);
    eq(count, 1, `expected exactly 1 row, found ${count}`);
    const { data: final } = await admin.from('members').select('name').eq('id', first[0].id).single();
    eq(final.name, 'Upsert probe EDITED', 'the update did not apply');
    return 'same id, 1 row, value updated';
  });

  await test('members upsert returns client_id so pushTable can map rows back', async () => {
    // pushTable builds remoteIdByClientId from the returned rows. If client_id
    // came back null, NOTHING would ever be marked synced and every row would
    // re-push forever.
    const clientId = randomUUID();
    const data = expectOk(await A.from('members')
      .upsert({ client_id: clientId, society_id: fx.societyA.id, membercode: 701, name: 'Map probe' }, { onConflict: 'society_id,membercode', ignoreDuplicates: false })
      .select('id, client_id'), 'upsert');
    track('members', data[0].id);
    eq(data[0].client_id, clientId, 'client_id did not round-trip — rows would never be marked synced');
    return 'client_id round-trips';
  });

  const CLIENT_ID_TABLES = {
    milk_collections: (s, cid) => ({ client_id: cid, society_id: s, membercode: 700, collect_date: today, weight: 10, fat: 4, price: 400 }),
    payouts: (s, cid) => ({ client_id: cid, society_id: s, membercode: 700, amount: 100, method: 'cash' }),
    ledger_entries: (s, cid) => ({ client_id: cid, society_id: s, membercode: 700, amount: 50, kind: 'jama' }),
    local_sales: (s, cid) => ({ client_id: cid, society_id: s, customer_name: 'Probe', quantity: 2, rate: 50, amount: 100, sale_date: today }),
    union_sales: (s, cid) => ({ client_id: cid, society_id: s, sale_date: today, quantity: 100, fat: 4, rate: 30, amount: 3000 }),
  };

  for (const [table, build] of Object.entries(CLIENT_ID_TABLES)) {
    await test(`${table} upsert on (society_id, client_id) is idempotent`, async () => {
      // The whole point of client_id: a retried push after a flaky rural
      // connection must not double-count a farmer's milk.
      const cid = randomUUID();
      const row = build(fx.societyA.id, cid);
      const first = expectOk(await A.from(table).upsert(row, { onConflict: 'society_id,client_id', ignoreDuplicates: false }).select('id, client_id'), 'first');
      const second = expectOk(await A.from(table).upsert(row, { onConflict: 'society_id,client_id', ignoreDuplicates: false }).select('id, client_id'), 'retry');
      track(table, first[0].id);

      eq(first[0].id, second[0].id, `retrying the push DUPLICATED the ${table} row`);
      eq(second[0].client_id, cid, 'client_id did not round-trip');
      const { count } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('society_id', fx.societyA.id).eq('client_id', cid);
      eq(count, 1, `expected 1 row after retry, found ${count}`);
      return 'retry-safe';
    });
  }

  await test('a 500-row batch upsert succeeds in one request (PUSH_CHUNK)', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      client_id: randomUUID(), society_id: fx.societyA.id, membercode: 800 + i,
      name: `Batch ${i}`,
    }));
    const t0 = Date.now();
    const data = expectOk(await A.from('members').upsert(rows, { onConflict: 'society_id,membercode', ignoreDuplicates: false }).select('id, client_id'), 'batch');
    const ms = Date.now() - t0;
    eq(data.length, 500, `expected 500 rows back, got ${data.length}`);
    await admin.from('members').delete().eq('society_id', fx.societyA.id).gte('membercode', 800).lte('membercode', 1299);
    return `500 rows in ${ms}ms`;
  });

  await test('a batch with one bad row rejects the WHOLE batch (all-or-nothing)', async () => {
    // Important operational property: a single malformed local row blocks every
    // other row in the same chunk from syncing.
    const rows = [
      { client_id: randomUUID(), society_id: fx.societyA.id, membercode: 900, name: 'Good' },
      { client_id: randomUUID(), society_id: fx.societyA.id, membercode: 901, name: null }, // NOT NULL
    ];
    const r = await A.from('members').upsert(rows, { onConflict: 'society_id,membercode', ignoreDuplicates: false }).select('id');
    const msg = expectAnyError(r, 'batch with bad row');
    const { count } = await admin.from('members').select('*', { count: 'exact', head: true }).eq('society_id', fx.societyA.id).eq('membercode', 900);
    eq(count, 0, 'the good row was committed despite the batch failing — not atomic');
    return `rejected atomically (${msg})`;
  });

  await test('pushing a row for a membercode that does not exist still succeeds', async () => {
    // DOCUMENTS GAP: milk_collections.membercode is a plain int with no FK to
    // members. sync.ts pushes members first "so the server knows the farmer",
    // but nothing enforces it — an orphan collection is accepted silently.
    const cid = randomUUID();
    const { data, error } = await A.from('milk_collections')
      .insert({ client_id: cid, society_id: fx.societyA.id, membercode: 99999, collect_date: today, weight: 5, fat: 4 })
      .select('id').single();
    track('milk_collections', data?.id);
    if (error) return `rejected (${error.code}) — an FK exists after all`;
    return 'ACCEPTED — no FK on membercode; orphan collections are possible';
  });

  // ---------------------------------------------------- edit/delete of synced
  suite('Sync · edit & delete');

  await test('updating a synced collection by remote id works (saveCollectionEdit)', async () => {
    const cid = randomUUID();
    const { data: row } = await A.from('milk_collections')
      .insert({ client_id: cid, society_id: fx.societyA.id, membercode: 700, collect_date: today, weight: 10, fat: 4, price: 400 })
      .select('id').single();
    track('milk_collections', row.id);
    const r = await A.from('milk_collections').update({ weight: 12, fat: 4.5, price: 480 }).eq('id', row.id);
    if (r.error) throw new Error(r.error.message);
    const { data: after } = await admin.from('milk_collections').select('weight').eq('id', row.id).single();
    eq(Number(after.weight), 12, 'edit did not apply');
    return 'ok';
  });

  await test("editing another society's collection silently no-ops (saveCollectionEdit reports success)", async () => {
    // saveCollectionEdit only checks `error`, and RLS makes a cross-tenant
    // UPDATE affect 0 rows WITHOUT an error — so it would write the local row
    // and report success while the server never changed. Local/server diverge.
    const { client: B } = await signedInAs(fx.userB.email, fx.password);
    const { data: row } = await admin.from('milk_collections')
      .insert({ client_id: randomUUID(), society_id: fx.societyA.id, membercode: 700, collect_date: today, weight: 10, fat: 4 })
      .select('id').single();
    track('milk_collections', row.id);

    const { error } = await B.from('milk_collections').update({ weight: 999 }).eq('id', row.id);
    const { data: after } = await admin.from('milk_collections').select('weight').eq('id', row.id).single();
    eq(Number(after.weight), 10, "another society's edit actually landed — RLS hole");
    return error
      ? `errored (${error.code}) — good`
      : 'NO ERROR + 0 rows changed → a caller checking only `error` believes it succeeded';
  });

  await test('deleting a collection by remote id works (deleteCollection)', async () => {
    const { data: row } = await A.from('milk_collections')
      .insert({ client_id: randomUUID(), society_id: fx.societyA.id, membercode: 700, collect_date: today, weight: 1, fat: 4 })
      .select('id').single();
    const r = await A.from('milk_collections').delete().eq('id', row.id);
    if (r.error) throw new Error(r.error.message);
    const { data: after } = await admin.from('milk_collections').select('id').eq('id', row.id).maybeSingle();
    eq(after, null, 'row survived the delete');
    return 'deleted';
  });

  // -------------------------------------------------------- rate chart backup
  suite('Sync · rate chart backup/restore');

  await test('backupRateChart creates a Default chart then replaces its entries', async () => {
    const { data: chart, error } = await A.from('rate_charts')
      .insert({ society_id: fx.societyA.id, name: 'Default', method: 'fat' })
      .select('id').single();
    if (error) throw new Error(error.message);

    const entries = Array.from({ length: 61 }, (_, i) => ({ chart_id: chart.id, fat: 3 + i * 0.1, snf: null, rate: (3 + i * 0.1) * 8 }));
    expectOk(await A.from('rate_chart_entries').insert(entries), 'insert entries');

    // backup runs delete-then-insert; prove the delete clears the old set.
    expectOk(await A.from('rate_chart_entries').delete().eq('chart_id', chart.id), 'clear');
    const { count } = await admin.from('rate_chart_entries').select('*', { count: 'exact', head: true }).eq('chart_id', chart.id);
    eq(count, 0, 'entries survived the clear — restore would return stale rates');

    expectOk(await A.from('rate_chart_entries').insert(entries.slice(0, 10)), 're-insert');
    const back = expectOk(await A.from('rate_chart_entries').select('fat, snf, rate').eq('chart_id', chart.id).order('fat'), 'restore');
    eq(back.length, 10, 'restore returned the wrong count');
    await admin.from('rate_charts').delete().eq('id', chart.id);
    return '61 → 0 → 10 round-trip ok';
  });

  await test('defaultChartId uses maybeSingle — two Default charts would break .single()', async () => {
    // restoreRateChart uses .maybeSingle(); if a society somehow gets two charts
    // named Default, maybeSingle throws PGRST116. Nothing prevents the duplicate.
    const { data: c1 } = await admin.from('rate_charts').insert({ society_id: fx.societyA.id, name: 'Default', method: 'fat' }).select('id').single();
    const { data: c2 } = await admin.from('rate_charts').insert({ society_id: fx.societyA.id, name: 'Default', method: 'fat' }).select('id').single();
    const r = await A.from('rate_charts').select('id').eq('society_id', fx.societyA.id).eq('name', 'Default').maybeSingle();
    await admin.from('rate_charts').delete().eq('id', c1.id);
    await admin.from('rate_charts').delete().eq('id', c2.id);
    if (r.error) return `DOCUMENTS GAP: duplicate Default charts are allowed and break restore → ${r.error.code}: ${r.error.message}`;
    return 'single Default returned';
  });

  for (const [t, id] of trash) await admin.from(t).delete().eq('id', id);
  await admin.from('members').delete().eq('society_id', fx.societyA.id).gte('membercode', 500).lte('membercode', 999);
}
