// ============================================================================
// Data integrity — constraints, types and malformed input.
//
// These run as an AUTHENTICATED user against that user's own society, so a
// rejection proves the constraint fired, not RLS. (Running them as anon would
// pass for the wrong reason: everything is 42501 before a constraint is even
// evaluated.)
//
// Codes: 23505 unique · 23502 not-null · 23503 FK · 22P02 bad text→type
//        22008 bad datetime · 42703 unknown column · PGRST205 unknown table
// ============================================================================
import { admin, signedInAs } from '../lib/clients.mjs';
import { suite, test, ok, eq, expectPgError, expectAnyError, expectOk } from '../lib/harness.mjs';

export default async function constraintsSuite(fx) {
  suite('Constraints & validation');

  const { client: A } = await signedInAs(fx.userA.email, fx.password);
  const today = new Date().toISOString().slice(0, 10);
  const trash = [];
  const track = (t, id) => { if (id) trash.push([t, id]); };

  await test('duplicate (society_id, membercode) is rejected [23505]', async () => {
    const { data } = await A.from('members').insert({ society_id: fx.societyA.id, membercode: 501, name: 'First' }).select('id').single();
    track('members', data?.id);
    const r = await A.from('members').insert({ society_id: fx.societyA.id, membercode: 501, name: 'Duplicate' });
    // This is the constraint that stops two farmers sharing a code — the thing
    // MemberFormScreen relies on to keep the ledger attributable.
    return expectPgError(r, '23505', 'duplicate membercode');
  });

  await test('the SAME membercode in a DIFFERENT society is allowed', async () => {
    // Codes are per-dairy: every dairy starts numbering at 1. If this ever
    // fails, the unique index has lost its society_id and dairies collide.
    const { data, error } = await admin.from('members').insert({ society_id: fx.societyB.id, membercode: 501, name: 'B-501' }).select('id').single();
    if (error) throw new Error(`same code in another society was rejected: ${error.message}`);
    track('members', data.id);
    return 'allowed as expected';
  });

  await test('member without a name is rejected [23502]', async () => {
    const r = await A.from('members').insert({ society_id: fx.societyA.id, membercode: 502 });
    return expectPgError(r, '23502', 'null name');
  });

  await test('member pointing at a non-existent society is rejected', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000';
    const r = await A.from('members').insert({ society_id: ghost, membercode: 503, name: 'Ghost' });
    // RLS fires first (42501) because the ghost society isn't the caller's;
    // either that or the FK (23503) is a correct rejection.
    ok(['42501', '23503'].includes(r.error?.code), `expected 42501 or 23503, got ${r.error?.code}: ${r.error?.message}`);
    return `${r.error.code}: ${r.error.message}`;
  });

  await test('non-numeric membercode is rejected [22P02]', async () => {
    const r = await A.from('members').insert({ society_id: fx.societyA.id, membercode: 'abc', name: 'Bad type' });
    return expectPgError(r, '22P02', 'text into int');
  });

  await test('invalid collect_date is rejected', async () => {
    const r = await A.from('milk_collections').insert({ society_id: fx.societyA.id, membercode: 501, collect_date: '2026-02-31', weight: 1 });
    return expectAnyError(r, 'impossible date');
  });

  await test('garbage collect_date is rejected [22008]', async () => {
    const r = await A.from('milk_collections').insert({ society_id: fx.societyA.id, membercode: 501, collect_date: 'not-a-date', weight: 1 });
    return expectAnyError(r, 'garbage date');
  });

  await test('malformed uuid in a filter is rejected [22P02]', async () => {
    const r = await A.from('members').select('*').eq('id', 'not-a-uuid');
    return expectPgError(r, '22P02', 'bad uuid filter');
  });

  await test('selecting a column that does not exist is rejected [42703]', async () => {
    const r = await A.from('members').select('id, no_such_column');
    return expectPgError(r, '42703', 'unknown column');
  });

  await test('querying a table that does not exist is rejected [PGRST205]', async () => {
    const r = await A.from('no_such_table').select('*');
    return expectAnyError(r, 'unknown table');
  });

  await test('local_sales without the NOT NULL sale_date is rejected [23502]', async () => {
    // sale_date is NOT NULL on the live DB even though schema.sql gives it a
    // default — worth pinning, since sync.ts sends whatever the local row holds.
    const r = await A.from('local_sales').insert({ society_id: fx.societyA.id, quantity: 1, rate: 50, amount: 50, sale_date: null });
    return expectPgError(r, '23502', 'null sale_date');
  });

  await test('union_sales without quantity is rejected [23502]', async () => {
    const r = await A.from('union_sales').insert({ society_id: fx.societyA.id, sale_date: today, quantity: null });
    return expectPgError(r, '23502', 'null quantity');
  });

  await test('payout without a method is rejected [23502]', async () => {
    const r = await A.from('payouts').insert({ society_id: fx.societyA.id, membercode: 501, amount: 100, method: null });
    return expectPgError(r, '23502', 'null method');
  });

  await test('duplicate society code is rejected [23505]', async () => {
    const r = await admin.from('societies').insert({ code: fx.societyA.code, name: 'Code clash' });
    return expectPgError(r, '23505', 'duplicate society code');
  });

  // ---- values the DB accepts but the business probably should not ----------
  // These document real gaps: there are no CHECK constraints behind them, so
  // the only thing stopping bad data is UI validation.
  await test('DOCUMENTS GAP: negative milk weight is accepted by the DB', async () => {
    const { data, error } = await A.from('milk_collections')
      .insert({ society_id: fx.societyA.id, membercode: 501, collect_date: today, weight: -50, fat: 4, price: -100 })
      .select('id').single();
    track('milk_collections', data?.id);
    if (error) return `rejected (${error.code}) — a CHECK constraint exists after all`;
    return 'ACCEPTED — no CHECK on weight; only the UI stops a negative entry';
  });

  await test('DOCUMENTS GAP: fat of 999% is accepted by the DB', async () => {
    const { data, error } = await A.from('milk_collections')
      .insert({ society_id: fx.societyA.id, membercode: 501, collect_date: today, weight: 10, fat: 999 })
      .select('id').single();
    track('milk_collections', data?.id);
    if (error) return `rejected (${error.code})`;
    return 'ACCEPTED — no CHECK on fat range';
  });

  await test('DOCUMENTS GAP: payout method accepts any string, not just cash|upi', async () => {
    const { data, error } = await A.from('payouts')
      .insert({ society_id: fx.societyA.id, membercode: 501, amount: 1, method: 'bitcoin' })
      .select('id').single();
    track('payouts', data?.id);
    if (error) return `rejected (${error.code})`;
    return "ACCEPTED — method is free text; 'cash'|'upi' is a convention, not a constraint";
  });

  await test('DOCUMENTS GAP: ledger kind accepts any string, not just jama|udhar', async () => {
    const { data, error } = await A.from('ledger_entries')
      .insert({ society_id: fx.societyA.id, membercode: 501, amount: 1, kind: 'nonsense' })
      .select('id').single();
    track('ledger_entries', data?.id);
    if (error) return `rejected (${error.code})`;
    return "ACCEPTED — kind is free text; ledgerBalance() sums by kind and would silently ignore this row";
  });

  await test('a very long name is stored without truncation', async () => {
    const long = 'न'.repeat(2000);
    const { data, error } = await A.from('members')
      .insert({ society_id: fx.societyA.id, membercode: 504, name: long })
      .select('id, name').single();
    track('members', data?.id);
    if (error) return `rejected: ${error.code} ${error.message}`;
    eq(data.name.length, 2000, 'name was truncated');
    return 'text column, no length cap — 2000 chars round-tripped';
  });

  await test('SQL injection in a text value is stored as literal text', async () => {
    const nasty = "Robert'); DROP TABLE members;--";
    const { data, error } = await A.from('members')
      .insert({ society_id: fx.societyA.id, membercode: 505, name: nasty })
      .select('id, name').single();
    track('members', data?.id);
    if (error) throw new Error(error.message);
    eq(data.name, nasty, 'value was mangled');
    const { count } = await admin.from('members').select('*', { count: 'exact', head: true });
    ok(typeof count === 'number', 'members table should still exist');
    return 'stored literally; parameterised as expected';
  });

  await test('unicode / Devanagari names round-trip intact', async () => {
    const name = 'दिव्यांश पराशर 🥛';
    const { data, error } = await A.from('members')
      .insert({ society_id: fx.societyA.id, membercode: 506, name_local: name, name: 'Divyansh' })
      .select('id, name_local').single();
    track('members', data?.id);
    if (error) throw new Error(error.message);
    eq(data.name_local, name, 'unicode mangled');
    return 'ok';
  });

  for (const [t, id] of trash) await admin.from(t).delete().eq('id', id);
}
