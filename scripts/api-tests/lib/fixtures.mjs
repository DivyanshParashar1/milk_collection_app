// ============================================================================
// Test fixtures — creates a disposable world, then removes it.
//
// SAFETY: this runs against the live project, which holds real dairy data.
// Every object created here is tagged with RUN_ID and teardown only ever
// deletes by that tag. Nothing here may delete by any broader filter — a stray
// `.neq()` or a bare `.delete()` would take out a customer's collections.
//
// The world:
//   societyA  — active subscription      + userA   (the normal case)
//   societyB  — active subscription      + userB   (the cross-tenant attacker)
//   societyC  — EXPIRED / is_active=false + userC   (the lockout case)
//
// Each pair is built the way production builds one: create the auth user and
// let the on_auth_user_created trigger mint its society, then adjust that
// society's dates. Creating a society separately would ALSO leave the trigger's
// auto-created one behind as an untagged orphan (random hex code) that no
// cleanup could find — a leak that quietly grew the societies table.
// ============================================================================
import { admin } from './clients.mjs';

export const RUN_ID = `t${Date.now().toString(36)}`;
const TAG = `TEST_${RUN_ID}`;
export const PASSWORD = 'test-password-123';

const created = { societies: [], users: [] };

/**
 * Create a signed-up user + the society the trigger gives it, then force that
 * society's subscription state. Returns both.
 */
async function makeTenant(suffix, { active = true, endsInDays = 30 } = {}) {
  const email = `${TAG}_${suffix}@milkapp.local`.toLowerCase();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true, // no inbox to click through in a test
    user_metadata: { full_name: `TEST ${suffix}`, society_name: `TEST Dairy ${suffix} (${RUN_ID})` },
  });
  if (error) throw new Error(`fixture: user ${suffix}: ${error.message}`);
  created.users.push(data.user.id);

  const { data: prof, error: pErr } = await admin
    .from('profiles').select('society_id').eq('id', data.user.id).maybeSingle();
  if (pErr) throw new Error(`fixture: profile ${suffix}: ${pErr.message}`);
  if (!prof) throw new Error(`fixture: no profile for ${suffix} — the on_auth_user_created trigger did not fire`);
  if (!prof.society_id) throw new Error(`fixture: profile ${suffix} has no society — the trigger no longer creates one`);
  created.societies.push(prof.society_id);

  // Tag the auto-created society and set the subscription state this tenant is for.
  const ends = new Date(Date.now() + endsInDays * 86400_000).toISOString();
  const { data: soc, error: sErr } = await admin
    .from('societies')
    .update({ code: `${TAG}_${suffix}`, is_active: active, subscription_end_date: ends })
    .eq('id', prof.society_id)
    .select('id, code, name, is_active, subscription_end_date')
    .single();
  if (sErr) throw new Error(`fixture: society ${suffix}: ${sErr.message}`);

  return { society: soc, user: { id: data.user.id, email } };
}

export async function setup() {
  const a = await makeTenant('A');
  const b = await makeTenant('B');
  // Expired 5 days ago AND flagged inactive — the two independent lock reasons.
  const c = await makeTenant('C', { active: false, endsInDays: -5 });

  return {
    societyA: a.society, societyB: b.society, societyC: c.society,
    userA: a.user, userB: b.user, userC: c.user,
    password: PASSWORD, tag: TAG,
  };
}

export async function teardown() {
  const errors = [];

  // Signup tests create users the fixture never registered, and the trigger
  // gives each one a society with a RANDOM hex code — untagged, so it can only
  // be found via the user's profile. Resolve those BEFORE deleting the users,
  // because deleting a user cascades its profile away and the link is lost.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const strayUsers = (list?.users ?? []).filter(
    (u) => u.email?.includes(TAG.toLowerCase()) && !created.users.includes(u.id)
  );
  for (const u of strayUsers) {
    const { data: prof } = await admin.from('profiles').select('society_id').eq('id', u.id).maybeSingle();
    if (prof?.society_id) created.societies.push(prof.society_id);
    created.users.push(u.id);
  }

  // Societies cascade to members/collections/payouts/ledger/sales/payments.
  for (const id of [...new Set(created.societies)]) {
    const { error } = await admin.from('societies').delete().eq('id', id);
    if (error) errors.push(`society ${id}: ${error.message}`);
  }
  // Deleting the auth user cascades to profiles.
  for (const id of [...new Set(created.users)]) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(`user ${id}: ${error.message}`);
  }

  // Belt and braces: anything still carrying this run's tag.
  const { data: tagged } = await admin.from('societies').select('id, code').like('code', `${TAG}%`);
  for (const s of tagged ?? []) {
    const { error } = await admin.from('societies').delete().eq('id', s.id);
    if (error) errors.push(`stray society ${s.code}: ${error.message}`);
  }

  return errors;
}

/**
 * Sweep leftovers from older interrupted runs.
 *
 * Matches test artefacts three ways, because the trigger's societies are not
 * tagged: by code (TEST_*), by the name the fixture asks the trigger to use
 * ('TEST Dairy %'/'TEST %'), and via the profiles of TEST_ users. Real dairies
 * ('My Dairy', 'Parashar dairy', …) match none of these.
 */
export async function sweepOldTestData() {
  const swept = { societies: 0, users: 0 };
  const doomed = new Set();

  const { data: byCode } = await admin.from('societies').select('id').like('code', 'TEST_%');
  for (const s of byCode ?? []) doomed.add(s.id);

  const { data: byName } = await admin.from('societies').select('id').like('name', 'TEST %');
  for (const s of byName ?? []) doomed.add(s.id);

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const testUsers = (list?.users ?? []).filter((u) => /^test_/i.test(u.email ?? ''));
  for (const u of testUsers) {
    const { data: prof } = await admin.from('profiles').select('society_id').eq('id', u.id).maybeSingle();
    if (prof?.society_id) doomed.add(prof.society_id);
  }

  for (const id of doomed) {
    const { error } = await admin.from('societies').delete().eq('id', id);
    if (!error) swept.societies++;
  }
  for (const u of testUsers) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (!error) swept.users++;
  }
  return swept;
}
