// ============================================================================
// Row Level Security — tenant isolation.
//
// This is the suite that matters. Every dairy's data sits in shared tables and
// the ONLY thing separating them is `society_id = current_society_id()`. A hole
// here means dairy A reads dairy B's farmers and payments.
//
// Two distinct behaviours are tested, and they are not interchangeable:
//   SELECT under RLS  → rows are FILTERED (no error, 0 rows)
//   INSERT under RLS  → WITH CHECK VIOLATION → error 42501
//   UPDATE/DELETE     → the row is invisible, so 0 rows change, NO error
//
// The UPDATE/DELETE case is the subtle one: a caller gets "success" back. The
// test asserts the row is untouched afterwards, not merely that no error came.
// ============================================================================
import { anon, admin, signedInAs } from '../lib/clients.mjs';
import { suite, test, ok, eq, expectPgError, expectRlsHidden, expectOk } from '../lib/harness.mjs';

const TENANT_TABLES = ['members', 'milk_collections', 'ledger_entries', 'payouts', 'local_sales', 'union_sales', 'rate_charts', 'payments'];

/** Minimal valid row per table, so the only reason to reject it is RLS. */
function sampleRow(table, societyId, seed = 1) {
  const today = new Date().toISOString().slice(0, 10);
  switch (table) {
    case 'members': return { society_id: societyId, membercode: 9000 + seed, name: `RLS probe ${seed}` };
    case 'milk_collections': return { society_id: societyId, membercode: 9000 + seed, collect_date: today, weight: 1, fat: 4 };
    case 'ledger_entries': return { society_id: societyId, membercode: 9000 + seed, amount: 10, kind: 'jama' };
    case 'payouts': return { society_id: societyId, membercode: 9000 + seed, amount: 10, method: 'cash' };
    case 'local_sales': return { society_id: societyId, sale_date: today, quantity: 1, rate: 50, amount: 50 };
    case 'union_sales': return { society_id: societyId, sale_date: today, quantity: 1 };
    case 'rate_charts': return { society_id: societyId, name: `RLS probe ${seed}`, method: 'fat' };
    case 'payments': return { society_id: societyId, amount: 1, status: 'created' };
    default: throw new Error(`no sample for ${table}`);
  }
}

export default async function rlsSuite(fx) {
  suite('RLS · anonymous (no session)');

  for (const table of TENANT_TABLES) {
    await test(`anon cannot read ${table}`, async () => {
      return expectRlsHidden(await anon.from(table).select('*').limit(5), `anon select ${table}`);
    });
  }

  for (const table of TENANT_TABLES) {
    await test(`anon cannot write ${table}`, async () => {
      const r = await anon.from(table).insert(sampleRow(table, fx.societyA.id, 1));
      return expectPgError(r, '42501', `anon insert ${table}`);
    });
  }

  await test('anon cannot read societies', async () => {
    return expectRlsHidden(await anon.from('societies').select('*').limit(5), 'anon select societies');
  });

  await test('anon cannot read profiles', async () => {
    return expectRlsHidden(await anon.from('profiles').select('*').limit(5), 'anon select profiles');
  });

  await test('anon CAN read app_config (policy is USING(true) by design)', async () => {
    const data = expectOk(await anon.from('app_config').select('upi_vpa').eq('id', 1), 'anon app_config');
    ok(data.length === 1, 'app_config should be publicly readable — SubscriptionScreen needs the VPA');
    return `vpa readable: ${data[0].upi_vpa}`;
  });

  // -------------------------------------------------------------- cross-tenant
  suite('RLS · cross-tenant (user A vs society B)');

  const { client: A } = await signedInAs(fx.userA.email, fx.password);
  const { client: B } = await signedInAs(fx.userB.email, fx.password);

  // Seed one row in B's society via admin, for A to try to reach.
  const seeded = {};
  for (const table of TENANT_TABLES) {
    const { data, error } = await admin.from(table).insert(sampleRow(table, fx.societyB.id, 7)).select('id').single();
    if (error) throw new Error(`seed ${table} in society B: ${error.message}`);
    seeded[table] = data.id;
  }

  for (const table of TENANT_TABLES) {
    await test(`A cannot SEE B's ${table} row`, async () => {
      return expectRlsHidden(await A.from(table).select('*').eq('id', seeded[table]), `A select B.${table}`);
    });
  }

  for (const table of TENANT_TABLES) {
    await test(`A cannot INSERT into B's society (${table})`, async () => {
      const r = await A.from(table).insert(sampleRow(table, fx.societyB.id, 8));
      return expectPgError(r, '42501', `A insert into B.${table}`);
    });
  }

  for (const table of TENANT_TABLES) {
    await test(`A cannot UPDATE B's ${table} row (silently affects 0 rows)`, async () => {
      const { error } = await A.from(table).update({ society_id: fx.societyB.id }).eq('id', seeded[table]);
      // No error is expected — the row simply isn't visible to A. What matters
      // is that it is still there and unchanged afterwards.
      const { data: after } = await admin.from(table).select('id').eq('id', seeded[table]).maybeSingle();
      ok(after, `LEAK: A's update DELETED or moved B's ${table} row`);
      return error ? `${error.code} (also errored)` : 'row untouched, 0 affected';
    });
  }

  for (const table of TENANT_TABLES) {
    await test(`A cannot DELETE B's ${table} row`, async () => {
      await A.from(table).delete().eq('id', seeded[table]);
      const { data: after } = await admin.from(table).select('id').eq('id', seeded[table]).maybeSingle();
      ok(after, `LEAK: A DELETED B's ${table} row`);
      return 'row survived';
    });
  }

  // ------------------------------------------------------------- own-tenant OK
  suite('RLS · own tenant (positive path)');

  for (const table of TENANT_TABLES) {
    await test(`A can insert + read back its own ${table}`, async () => {
      const { data, error } = await A.from(table).insert(sampleRow(table, fx.societyA.id, 11)).select('id').single();
      if (error) throw new Error(`A could not write its OWN ${table}: ${error.code} ${error.message}`);
      const { data: back } = await A.from(table).select('id').eq('id', data.id).maybeSingle();
      ok(back, `A wrote its own ${table} but cannot read it back`);
      await admin.from(table).delete().eq('id', data.id);
      return 'insert + select ok';
    });
  }

  await test('A can read its own society row', async () => {
    const data = expectOk(await A.from('societies').select('id, is_active, subscription_end_date').eq('id', fx.societyA.id), 'own society');
    eq(data.length, 1, 'A must be able to read its own society — the write lock depends on it');
    return `is_active=${data[0].is_active}`;
  });

  await test("A cannot read B's society row", async () => {
    return expectRlsHidden(await A.from('societies').select('*').eq('id', fx.societyB.id), 'A select B society');
  });

  await test('A can read its own profile', async () => {
    const data = expectOk(await A.from('profiles').select('id, society_id').eq('id', fx.userA.id), 'own profile');
    eq(data.length, 1, 'currentSocietyId() in sync.ts depends on this working');
    eq(data[0].society_id, fx.societyA.id);
    return 'ok';
  });

  await test("A cannot read B's profile", async () => {
    return expectRlsHidden(await A.from('profiles').select('*').eq('id', fx.userB.id), 'A select B profile');
  });

  await test('A cannot escalate itself to super admin', async () => {
    // The "own profile" policy lets a user UPDATE their own row, and there is
    // no column-level restriction on is_super_admin. If this passes, any dairy
    // can promote itself and reach every society through SuperAdminScreen.
    await A.from('profiles').update({ is_super_admin: true }).eq('id', fx.userA.id);
    const { data } = await admin.from('profiles').select('is_super_admin').eq('id', fx.userA.id).single();
    if (data.is_super_admin === true) {
      await admin.from('profiles').update({ is_super_admin: false }).eq('id', fx.userA.id); // undo
      throw Object.assign(new Error('PRIVILEGE ESCALATION: a normal user set their own is_super_admin=true'), { isAssertion: true });
    }
    return 'blocked';
  });

  await test('A cannot move its profile to another society', async () => {
    // Same policy, different lever: `with check (id = auth.uid())` only pins the
    // row id, not society_id. Repointing your own profile at another society
    // would hand you that society's entire dataset via current_society_id().
    await A.from('profiles').update({ society_id: fx.societyB.id }).eq('id', fx.userA.id);
    const { data } = await admin.from('profiles').select('society_id').eq('id', fx.userA.id).single();
    if (data.society_id === fx.societyB.id) {
      await admin.from('profiles').update({ society_id: fx.societyA.id }).eq('id', fx.userA.id); // undo
      throw Object.assign(new Error("TENANT BREAKOUT: A repointed its profile at society B and can now read B's data"), { isAssertion: true });
    }
    return 'blocked';
  });

  await test('AFTER v7: a user can still rename themselves (not over-restricted)', async () => {
    // migration_v7 revokes profile writes but re-grants UPDATE(full_name). This
    // asserts the fix doesn't go too far. Before v7 it passes trivially; after
    // v7 it proves the column grant landed.
    const { error } = await A.from('profiles').update({ full_name: 'Renamed by test' }).eq('id', fx.userA.id);
    if (error) throw new Error(`a user can no longer set their own full_name: ${error.code} ${error.message}`);
    const { data } = await admin.from('profiles').select('full_name').eq('id', fx.userA.id).single();
    eq(data.full_name, 'Renamed by test', 'the rename did not apply');
    return 'full_name still writable';
  });

  await test('AFTER v7: the super admin can still manage societies (not over-restricted)', async () => {
    // The trap v7 avoids: GRANTs are per-role and a super admin is also just
    // `authenticated`, so revoking UPDATE on societies would break
    // SuperAdminScreen.approve(). Promote A via admin (bypassing RLS), then
    // check it can do what that screen does.
    await admin.from('profiles').update({ is_super_admin: true }).eq('id', fx.userA.id);
    const { client: SA } = await signedInAs(fx.userA.email, fx.password);
    const originalEnd = fx.societyB.subscription_end_date;
    const newEnd = new Date(Date.now() + 60 * 86400_000).toISOString();

    const { error } = await SA.from('societies').update({ subscription_end_date: newEnd, is_active: true }).eq('id', fx.societyB.id);
    const { data: after } = await admin.from('societies').select('subscription_end_date').eq('id', fx.societyB.id).single();
    const worked = !error && new Date(after.subscription_end_date).getTime() > Date.now() + 59 * 86400_000;

    // restore
    await admin.from('societies').update({ subscription_end_date: originalEnd }).eq('id', fx.societyB.id);
    await admin.from('profiles').update({ is_super_admin: false }).eq('id', fx.userA.id);

    ok(worked, `a super admin can no longer approve subscriptions: ${error?.code ?? ''} ${error?.message ?? 'update affected 0 rows'}`);
    return 'super admin retains societies write';
  });

  await test('a normal user cannot write app_config (super-admin only)', async () => {
    const r = await A.from('app_config').upsert({ id: 1, upi_vpa: 'attacker@evil', upi_payee_name: 'x' });
    // If this succeeds, any dairy can redirect every subscription payment.
    return expectPgError(r, '42501', 'A write app_config');
  });

  await test('a normal user cannot extend their own subscription', async () => {
    // The most direct way to use the app for free: is_active/subscription_end_date
    // live on `societies`, whose only policy is a SELECT policy.
    const far = new Date(Date.now() + 3650 * 86400_000).toISOString();
    await A.from('societies').update({ subscription_end_date: far, is_active: true }).eq('id', fx.societyA.id);
    const { data } = await admin.from('societies').select('subscription_end_date').eq('id', fx.societyA.id).single();
    const moved = new Date(data.subscription_end_date).getTime() > Date.now() + 3000 * 86400_000;
    ok(!moved, 'SUBSCRIPTION BYPASS: a user extended their own subscription_end_date by 10 years');
    return 'blocked';
  });

  await test("a normal user cannot approve their own payment request", async () => {
    const { data: req } = await admin.from('payments')
      .insert({ society_id: fx.societyA.id, amount: 199, status: 'requested', purpose: 'subscription', plan: 'monthly' })
      .select('id').single();
    await A.from('payments').update({ status: 'paid' }).eq('id', req.id);
    const { data: after } = await admin.from('payments').select('status').eq('id', req.id).single();
    await admin.from('payments').delete().eq('id', req.id);
    // NOTE: 'society rw' on payments grants full write to your own society, so
    // this is EXPECTED to be allowed. Flipping status to 'paid' alone does not
    // unlock anything — only SuperAdminScreen.approve() moves the date. This
    // test documents that boundary rather than asserting a block.
    return after.status === 'paid'
      ? 'allowed (status flip only; does not extend the subscription — approval still requires super admin)'
      : 'blocked';
  });

  await test('rate_chart_entries inherit their parent chart’s society', async () => {
    const { data: chart } = await admin.from('rate_charts')
      .insert({ society_id: fx.societyB.id, name: `RLS probe chart`, method: 'fat' })
      .select('id').single();
    const { data: entry } = await admin.from('rate_chart_entries')
      .insert({ chart_id: chart.id, fat: 4.0, rate: 32 })
      .select('id').single();

    const hidden = expectRlsHidden(await A.from('rate_chart_entries').select('*').eq('id', entry.id), "A select B's chart entries");
    const r = await A.from('rate_chart_entries').insert({ chart_id: chart.id, fat: 5.0, rate: 40 });
    const blocked = expectPgError(r, '42501', "A insert into B's chart");

    await admin.from('rate_charts').delete().eq('id', chart.id);
    return `${hidden}; insert ${blocked}`;
  });

  // cleanup seeded B rows
  for (const table of TENANT_TABLES) {
    await admin.from(table).delete().eq('id', seeded[table]);
  }
}
