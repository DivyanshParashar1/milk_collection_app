// ============================================================================
// Subscription & lockout — the server half.
//
// The lock itself is CLIENT-side: computeLocked() reads settings written by the
// last pull. So there are two separable questions, and this suite only answers
// the first:
//
//   1. Does the server hand the device the right subscription facts?  ← here
//   2. Does the device lock correctly given those facts?              ← DevScreen
//
// The pure predicate is duplicated below from subscription.ts. That duplication
// is deliberate: src/ can't be imported here (AsyncStorage/react-native), and
// the truth table is the thing worth pinning. If the two ever disagree, the
// DevScreen "Lock predicate" section is the tiebreaker.
// ============================================================================
import { admin, signedInAs } from '../lib/clients.mjs';
import { suite, test, ok, eq, expectOk } from '../lib/harness.mjs';

/**
 * Mirrors computeLocked() in src/lib/subscription.ts.
 * Keep the two in lockstep — if src/ changes, change this, or the truth table
 * below happily proves the OLD behaviour and tells you nothing.
 */
function computeLocked({ isActive, subscriptionEnd }, now = Date.now()) {
  // Unlocked needs positive proof of a subscription: a missing end date locks
  // (migration v8 — no trial; a new society is born with a null end date).
  if (!subscriptionEnd) return true;
  const expired = now > new Date(subscriptionEnd).getTime();
  return isActive === false || expired;
}

export default async function subscriptionSuite(fx) {
  suite('Subscription · server facts');

  const { client: A } = await signedInAs(fx.userA.email, fx.password);
  const { client: C } = await signedInAs(fx.userC.email, fx.password);

  await test('pullAll reads subscription_end_date + is_active for an active dairy', async () => {
    // The exact query pullAll runs.
    const { data, error } = await A.from('societies').select('subscription_end_date, is_active').eq('id', fx.societyA.id).single();
    if (error) throw new Error(error.message);
    eq(data.is_active, true);
    ok(new Date(data.subscription_end_date) > new Date(), 'fixture society A should be unexpired');
    eq(computeLocked({ isActive: data.is_active, subscriptionEnd: data.subscription_end_date }), false, 'an active dairy must NOT be locked');
    return `ends ${data.subscription_end_date}, locked=false`;
  });

  await test('an expired + inactive dairy reports facts that lock the device', async () => {
    const { data, error } = await C.from('societies').select('subscription_end_date, is_active').eq('id', fx.societyC.id).single();
    if (error) throw new Error(error.message);
    eq(data.is_active, false);
    ok(new Date(data.subscription_end_date) < new Date(), 'fixture society C should be expired');
    eq(computeLocked({ isActive: data.is_active, subscriptionEnd: data.subscription_end_date }), true, 'an expired dairy MUST lock');
    return `ends ${data.subscription_end_date}, locked=true`;
  });

  await test('an expired dairy can still PULL (renewal must be able to reach it)', async () => {
    // sync.ts exempts pulls from the lock on purpose: if a lapsed device could
    // not pull, a renewal could never arrive and the user would be stranded.
    const r = await C.from('members').select('*').eq('society_id', fx.societyC.id).gt('updated_at', '1970-01-01T00:00:00Z');
    if (r.error) throw new Error(`a lapsed dairy cannot pull — it could never be renewed: ${r.error.message}`);
    return 'pull allowed while locked';
  });

  await test('IMPORTANT: an expired dairy can still WRITE to the server (lock is client-only)', async () => {
    // The lock is enforced in the app, not in Postgres. A modified client, or a
    // stale `locked` flag, can still push. Worth knowing explicitly: the
    // subscription is a UI gate, not a security boundary.
    const { data, error } = await C.from('members')
      .insert({ society_id: fx.societyC.id, membercode: 950, name: 'Written while expired' })
      .select('id').single();
    if (error) return `server REJECTED the write (${error.code}) — stronger than expected`;
    await admin.from('members').delete().eq('id', data.id);
    return 'ACCEPTED — no server-side subscription enforcement; the lock lives only in the app';
  });

  // ---- the truth table computeLocked() has to get right ---------------------
  suite('Subscription · lock predicate truth table');

  const DAY = 86400_000;
  const cases = [
    ['active, ends in 30 days',        { isActive: true,  subscriptionEnd: new Date(Date.now() + 30 * DAY).toISOString() }, false],
    ['active, ends in 1 minute',       { isActive: true,  subscriptionEnd: new Date(Date.now() + 60_000).toISOString() },   false],
    ['active, expired 1 minute ago',   { isActive: true,  subscriptionEnd: new Date(Date.now() - 60_000).toISOString() },   true],
    ['active, expired 5 days ago',     { isActive: true,  subscriptionEnd: new Date(Date.now() - 5 * DAY).toISOString() },  true],
    ['INACTIVE but not yet expired',   { isActive: false, subscriptionEnd: new Date(Date.now() + 30 * DAY).toISOString() }, true],
    ['INACTIVE and expired',           { isActive: false, subscriptionEnd: new Date(Date.now() - 5 * DAY).toISOString() },  true],
    // No end date = never subscribed (v8 removed the 14-day trial), so it locks.
    ['active, no end date set',        { isActive: true,  subscriptionEnd: '' },                                            true],
    ['INACTIVE, no end date set',      { isActive: false, subscriptionEnd: '' },                                            true],
  ];

  for (const [label, settings, expected] of cases) {
    await test(`${label} → ${expected ? 'LOCKED' : 'unlocked'}`, async () => {
      eq(computeLocked(settings), expected, 'wrong lock decision');
      return expected ? 'locked' : 'unlocked';
    });
  }

  await test('EDGE: a fresh install with no subscription data is LOCKED', async () => {
    // DEFAULT_SETTINGS is { isActive: true, subscriptionEnd: '' }. Before v8 this
    // read as "not expired" and a reinstall bought full write access until the
    // first pull. Now a missing date locks, so the bypass is closed: the device
    // must pull a real end date before it can write.
    eq(computeLocked({ isActive: true, subscriptionEnd: '' }), true);
    return 'locked before first sync — the reinstall bypass is closed';
  });

  await test('EDGE: a malformed subscriptionEnd does NOT lock (NaN comparison)', async () => {
    // new Date('garbage').getTime() is NaN, and `now > NaN` is false — so a
    // corrupt value fails OPEN rather than locking the user out.
    const locked = computeLocked({ isActive: true, subscriptionEnd: 'garbage' });
    eq(locked, false, 'expected NaN comparison to fail open');
    return 'fails OPEN (unlocked) on corrupt data — safer for the farmer, weaker as a gate';
  });

  // ---- approval flow --------------------------------------------------------
  suite('Subscription · approval flow');

  await test('raiseSubscriptionRequest inserts a "requested" payment', async () => {
    const data = expectOk(await A.from('payments').insert({
      society_id: fx.societyA.id, amount: 199, purpose: 'subscription', plan: 'monthly',
      status: 'requested', note: 'UPI ₹199 → test@upi',
    }).select('id, status'), 'raise request');
    ok(data?.length, 'no payment row returned');
    await admin.from('payments').delete().eq('id', data[0].id);
    eq(data[0].status, 'requested');
    return 'request raised';
  });

  await test('SuperAdminScreen.approve extends from the LATER of now / current end', async () => {
    // approve() picks base = max(now, currentEnd) so renewing early adds to the
    // remaining time instead of throwing it away.
    const planDays = (id) => (id === 'yearly' ? 365 : 30);
    const extend = (currentEndIso, planId) => {
      const currentEnd = currentEndIso ? new Date(currentEndIso) : new Date();
      const base = currentEnd.getTime() > Date.now() ? currentEnd : new Date();
      const newEnd = new Date(base);
      newEnd.setDate(newEnd.getDate() + planDays(planId));
      return newEnd;
    };

    const future = new Date(Date.now() + 10 * DAY).toISOString();
    const renewedEarly = extend(future, 'monthly');
    ok(renewedEarly.getTime() > Date.now() + 39 * DAY, 'early renewal LOST the remaining 10 days');

    const past = new Date(Date.now() - 10 * DAY).toISOString();
    const renewedLate = extend(past, 'monthly');
    ok(renewedLate.getTime() > Date.now() + 29 * DAY, 'late renewal should start from today');
    ok(renewedLate.getTime() < Date.now() + 31 * DAY, 'late renewal should NOT credit the lapsed days');

    return `early: +40d (10 kept), late: +30d from today`;
  });

  await test('approving a request actually unlocks the dairy', async () => {
    // End to end: society C is locked; run what approve() runs; re-read the way
    // pullAll does; the predicate must flip to unlocked.
    const before = await C.from('societies').select('subscription_end_date, is_active').eq('id', fx.societyC.id).single();
    eq(computeLocked({ isActive: before.data.is_active, subscriptionEnd: before.data.subscription_end_date }), true, 'C should start locked');

    const newEnd = new Date(Date.now() + 30 * DAY).toISOString();
    expectOk(await admin.from('societies').update({ subscription_end_date: newEnd, is_active: true }).eq('id', fx.societyC.id), 'approve');

    const after = await C.from('societies').select('subscription_end_date, is_active').eq('id', fx.societyC.id).single();
    eq(computeLocked({ isActive: after.data.is_active, subscriptionEnd: after.data.subscription_end_date }), false, 'the dairy is STILL locked after approval');

    // restore C to its locked fixture state for any later suite
    await admin.from('societies').update({ subscription_end_date: new Date(Date.now() - 5 * DAY).toISOString(), is_active: false }).eq('id', fx.societyC.id);
    return 'locked → approved → unlocked';
  });

  await test('toggling is_active=false locks an otherwise-valid dairy', async () => {
    await admin.from('societies').update({ is_active: false }).eq('id', fx.societyA.id);
    const { data } = await A.from('societies').select('subscription_end_date, is_active').eq('id', fx.societyA.id).single();
    eq(computeLocked({ isActive: data.is_active, subscriptionEnd: data.subscription_end_date }), true, 'disabling a dairy did not lock it');
    await admin.from('societies').update({ is_active: true }).eq('id', fx.societyA.id);
    return 'kill switch works';
  });

  await test('app_config exposes the payee VPA to signed-in users', async () => {
    const data = expectOk(await A.from('app_config').select('upi_vpa, upi_payee_name').eq('id', 1), 'app_config');
    eq(data.length, 1, 'SubscriptionScreen falls back to a hardcoded VPA if this breaks');
    ok(data[0].upi_vpa, 'upi_vpa is empty — payments would go to the hardcoded default');
    return `vpa=${data[0].upi_vpa}`;
  });
}
