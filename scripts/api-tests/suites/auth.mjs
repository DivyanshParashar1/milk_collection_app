// ============================================================================
// Supabase Auth — every failure mode LoginScreen claims to handle.
//
// LoginScreen maps raw Supabase errors to bilingual messages by matching on
// message TEXT ('Invalid login credentials', 'already registered', …). That
// mapping is only as good as the strings Supabase actually returns, so these
// tests assert the strings themselves. If Supabase rewords one, a test here
// fails and tells you which alert silently degraded to the generic 'Error'.
// ============================================================================
import { freshAnon, anon } from '../lib/clients.mjs';
import { suite, test, ok, eq, expectAnyError, expectOk } from '../lib/harness.mjs';

// Mirrors LoginScreen.submit()'s branches so a reworded upstream message shows
// up as "which alert breaks", not just "a string changed".
function loginScreenBranch(msg) {
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) return 'wrong-password';
  if (msg.includes('Email rate limit') || msg.includes('rate limit')) return 'rate-limit';
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'already-registered';
  if (msg.includes('Network') || msg.includes('fetch')) return 'no-internet';
  return 'generic-Error-alert';
}

export default async function authSuite(fx) {
  suite('Auth');

  await test('signIn with correct password returns a session', async () => {
    const c = freshAnon();
    const { data, error } = await c.auth.signInWithPassword({ email: fx.userA.email, password: fx.password });
    if (error) throw new Error(error.message);
    ok(data.session?.access_token, 'no access_token returned');
    eq(data.user.email, fx.userA.email);
    return `token len ${data.session.access_token.length}`;
  });

  await test('signIn with wrong password → LoginScreen shows "wrong password"', async () => {
    const c = freshAnon();
    const r = await c.auth.signInWithPassword({ email: fx.userA.email, password: 'definitely-wrong' });
    const msg = expectAnyError(r, 'wrong password');
    eq(loginScreenBranch(r.error.message), 'wrong-password', 'LoginScreen would show the WRONG alert');
    return msg;
  });

  await test('signIn as a user that does not exist → same generic message (no user enumeration)', async () => {
    const c = freshAnon();
    const r = await c.auth.signInWithPassword({ email: `nobody_${Date.now()}@milkapp.local`, password: 'whatever123' });
    expectAnyError(r, 'unknown user');
    // Identical wording for "no such user" and "bad password" is deliberate:
    // it stops an attacker discovering which mobile numbers are registered.
    eq(loginScreenBranch(r.error.message), 'wrong-password', 'unknown user should look like a wrong password');
    return r.error.message;
  });

  await test('signIn with empty password is rejected', async () => {
    const c = freshAnon();
    return expectAnyError(await c.auth.signInWithPassword({ email: fx.userA.email, password: '' }), 'empty password');
  });

  await test('signUp with a fresh mobile creates an account', async () => {
    const c = freshAnon();
    const email = `${fx.tag}_signup1@milkapp.local`.toLowerCase();
    const { data, error } = await c.auth.signUp({
      email, password: 'newpassword123',
      options: { data: { full_name: 'TEST Signup', society_name: 'TEST Signup' } },
    });
    if (error) throw new Error(error.message);
    ok(data.user?.id, 'no user returned');
    return `user ${data.user.id.slice(0, 8)}`;
  });

  await test('the signup trigger creates a profile AND its own society', async () => {
    // handle_new_user() is what makes a new dairy usable at all — if it stops
    // firing, signup "succeeds" and then every sync fails with "no society set".
    // NOTE: the DEPLOYED trigger (migration_full_sync.sql) also mints a society
    // per signup. schema.sql shows the older version that only inserts a
    // profile — it is stale; trust this test over that file.
    const { admin } = await import('../lib/clients.mjs');
    const email = `${fx.tag}_signup1@milkapp.local`.toLowerCase();
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const u = list.users.find((x) => x.email === email);
    ok(u, 'signup user not found');

    const { data: prof, error } = await admin.from('profiles').select('id, full_name, society_id, is_super_admin').eq('id', u.id).maybeSingle();
    if (error) throw new Error(error.message);
    ok(prof, 'NO PROFILE ROW — the on_auth_user_created trigger did not fire');
    eq(prof.full_name, 'TEST Signup', 'full_name not carried from user metadata');
    ok(prof.society_id, 'signup left society_id null — the new dairy could never sync');
    eq(prof.is_super_admin, false, 'a fresh signup must NOT be a super admin');

    const { data: soc } = await admin.from('societies').select('name, is_active, subscription_end_date').eq('id', prof.society_id).single();
    eq(soc.name, 'TEST Signup', 'society name should come from the signup metadata');
    eq(soc.is_active, true, 'a new dairy should start active');
    return `society "${soc.name}" created, subscription_end_date ${soc.subscription_end_date ?? 'null'}`;
  });

  await test('a new signup gets NO trial, so it starts LOCKED', async () => {
    // There is no trial (migration v8): handle_new_user() creates the society with
    // a null subscription_end_date, and computeLocked() treats a missing date as
    // locked. If a default ever creeps back onto that column, every new dairy gets
    // free write access until it lapses — which is what this asserts against.
    const { admin } = await import('../lib/clients.mjs');
    const email = `${fx.tag}_signup1@milkapp.local`.toLowerCase();
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const u = list.users.find((x) => x.email === email);
    const { data: prof } = await admin.from('profiles').select('society_id').eq('id', u.id).single();
    const { data: soc } = await admin.from('societies').select('subscription_end_date').eq('id', prof.society_id).single();

    eq(soc.subscription_end_date, null,
      `a new dairy must start with no subscription, got ${soc.subscription_end_date}`);
    return 'no trial → locked from day 1';
  });

  await test('two separate signups land in DIFFERENT societies', async () => {
    // The one that would be catastrophic: if the trigger ever reused a society,
    // every dairy in the country would share one dataset.
    const { admin } = await import('../lib/clients.mjs');
    const c = freshAnon();
    const mk = async (n) => {
      const email = `${fx.tag}_iso${n}@milkapp.local`.toLowerCase();
      const { data, error } = await c.auth.signUp({ email, password: 'isolation123', options: { data: { full_name: `Iso ${n}`, society_name: `Iso ${n}` } } });
      if (error) throw new Error(error.message);
      const { data: p } = await admin.from('profiles').select('society_id').eq('id', data.user.id).single();
      return p.society_id;
    };
    const s1 = await mk(1);
    const s2 = await mk(2);
    ok(s1 && s2, 'signup did not produce societies');
    ok(s1 !== s2, 'TENANT COLLISION: two signups share one society — every dairy would see the same data');
    return 'each signup isolated';
  });

  await test('signUp twice with the same mobile → LoginScreen shows "already registered"', async () => {
    const c = freshAnon();
    const email = `${fx.tag}_signup1@milkapp.local`.toLowerCase();
    const { data, error } = await c.auth.signUp({ email, password: 'newpassword123' });

    // Supabase can be configured to NOT error on duplicate signup (anti-
    // enumeration): it returns a user with an empty identities array instead.
    // LoginScreen treats a non-error as success and tells the user to sign in,
    // which is survivable — but worth knowing which mode this project is in.
    if (!error) {
      const identities = data.user?.identities ?? [];
      eq(identities.length, 0, 'duplicate signup returned a real identity — that would be a NEW account');
      return 'no error; obfuscated (identities=[]) — LoginScreen says "account created", user can still sign in';
    }
    eq(loginScreenBranch(error.message), 'already-registered', 'LoginScreen would show the WRONG alert');
    return error.message;
  });

  await test('signUp with a password under 6 chars is rejected', async () => {
    const c = freshAnon();
    const r = await c.auth.signUp({ email: `${fx.tag}_weak@milkapp.local`.toLowerCase(), password: '123' });
    // LoginScreen also blocks this client-side; this proves the server agrees,
    // so the rule holds even if the client check is bypassed.
    return expectAnyError(r, 'weak password');
  });

  await test('signUp with a malformed email is rejected', async () => {
    const c = freshAnon();
    return expectAnyError(await c.auth.signUp({ email: 'not-an-email', password: 'password123' }), 'bad email');
  });

  await test('getSession on a fresh client is null', async () => {
    const c = freshAnon();
    const { data } = await c.auth.getSession();
    eq(data.session, null, 'a fresh client should not be signed in');
    return 'null as expected';
  });

  await test('signOut clears the session', async () => {
    const c = freshAnon();
    await c.auth.signInWithPassword({ email: fx.userA.email, password: fx.password });
    await c.auth.signOut();
    const { data } = await c.auth.getSession();
    eq(data.session, null, 'session survived signOut');
    return 'session cleared';
  });

  await test('a garbage JWT is rejected with 401', async () => {
    const res = await fetch(`${process.env.SUPABASE_URL ?? (await import('../lib/clients.mjs')).SUPABASE_URL}/rest/v1/members?select=id`, {
      headers: {
        apikey: (await import('../lib/clients.mjs')).ANON_KEY,
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.garbage.signature',
      },
    });
    eq(res.status, 401, 'a forged token should be rejected');
    return `401 ${(await res.json()).message ?? ''}`;
  });

  await test('an expired JWT is rejected', async () => {
    const { SUPABASE_URL, ANON_KEY } = await import('../lib/clients.mjs');
    // Structurally valid, exp in 2020, signed with the wrong secret.
    const expired = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6MTU3NzgzNjgwMH0.fake';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/members?select=id`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${expired}` },
    });
    eq(res.status, 401, 'an expired token should be rejected');
    return `401 as expected`;
  });

  await test('a request with no apikey at all is rejected', async () => {
    const { SUPABASE_URL } = await import('../lib/clients.mjs');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/members?select=id`);
    ok(res.status === 401, `expected 401, got ${res.status}`);
    return `${res.status}`;
  });
}
