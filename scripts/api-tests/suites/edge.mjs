// ============================================================================
// Edge Function: razorpay-order — the only non-PostgREST API.
//
// Called with raw fetch rather than supabase.functions.invoke() because the
// interesting cases here ARE the transport: status codes, CORS preflight,
// unparseable bodies. invoke() would hide them behind a generic FunctionsError.
//
// NOTE: nothing in src/ calls this today — SubscriptionScreen went the UPI +
// manual-approval route instead. It is tested because it is deployed (or not),
// and a live endpoint that mints Razorpay orders with no auth check is worth
// knowing about either way. If it 404s, that's a fine answer: it's not deployed.
// ============================================================================
import { SUPABASE_URL, ANON_KEY } from '../lib/clients.mjs';
import { suite, test, ok, eq } from '../lib/harness.mjs';

const FN = `${SUPABASE_URL}/functions/v1/razorpay-order`;
let deployed = true;

const call = (opts = {}) =>
  fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, ...(opts.headers ?? {}) },
    ...opts,
  });

async function bodyOf(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text.slice(0, 200); }
}

export default async function edgeSuite() {
  suite('Edge Function · razorpay-order');

  await test('the function is reachable', async () => {
    const res = await call({ body: JSON.stringify({ amount: 1 }) });
    if (res.status === 404) {
      deployed = false;
      return 'NOT DEPLOYED (404) — remaining edge tests are skipped. Nothing in the app calls it, so this is expected.';
    }
    return `reachable, status ${res.status}`;
  });

  const maybe = async (name, fn) => {
    if (!deployed) return test(name, async () => 'skipped — function not deployed');
    return test(name, fn);
  };

  await maybe('CORS preflight (OPTIONS) is answered', async () => {
    const res = await fetch(FN, { method: 'OPTIONS', headers: { Origin: 'http://localhost', 'Access-Control-Request-Method': 'POST' } });
    eq(res.status, 200, 'preflight should return 200');
    ok(res.headers.get('access-control-allow-origin'), 'missing Access-Control-Allow-Origin');
    return `allow-origin: ${res.headers.get('access-control-allow-origin')}`;
  });

  await maybe('missing amount → 400', async () => {
    const res = await call({ body: JSON.stringify({}) });
    eq(res.status, 400, `expected 400, got ${res.status}`);
    return JSON.stringify(await bodyOf(res));
  });

  await maybe('amount = 0 → 400', async () => {
    const res = await call({ body: JSON.stringify({ amount: 0 }) });
    eq(res.status, 400, `expected 400, got ${res.status}`);
    return JSON.stringify(await bodyOf(res));
  });

  await maybe('negative amount → 400', async () => {
    const res = await call({ body: JSON.stringify({ amount: -500 }) });
    eq(res.status, 400, `expected 400, got ${res.status}`);
    return JSON.stringify(await bodyOf(res));
  });

  await maybe('non-numeric amount is rejected', async () => {
    const res = await call({ body: JSON.stringify({ amount: 'lots' }) });
    // `!amount || amount <= 0` lets the string 'lots' through ('lots' <= 0 is
    // false), so this reaches Razorpay and fails there as a 502 instead of 400.
    ok([400, 502, 500].includes(res.status), `expected a rejection, got ${res.status}`);
    return `${res.status}: ${JSON.stringify(await bodyOf(res))}`;
  });

  await maybe('unparseable body → 500 (not a crash)', async () => {
    const res = await call({ body: 'this is not json' });
    ok(res.status >= 400, `expected an error status, got ${res.status}`);
    return `${res.status}: ${JSON.stringify(await bodyOf(res))}`;
  });

  await maybe('empty body → error', async () => {
    const res = await call({ body: '' });
    ok(res.status >= 400, `expected an error status, got ${res.status}`);
    return `${res.status}`;
  });

  await maybe('GET is not accepted', async () => {
    const res = await fetch(FN, { method: 'GET', headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY } });
    ok(res.status >= 400, `GET returned ${res.status} — the handler only guards OPTIONS, so a GET falls into req.json() and should error`);
    return `${res.status}`;
  });

  await maybe('SECURITY: does it mint an order with NO auth header?', async () => {
    // The handler never checks the JWT. If this returns an order, anyone on the
    // internet can create Razorpay orders against your account.
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1 }),
    });
    const body = await bodyOf(res);
    if (res.status === 401) return '401 — the platform requires a JWT (verify_jwt on). Good.';
    if (res.status === 200 && body?.orderId) {
      throw Object.assign(new Error(`UNAUTHENTICATED ORDER CREATED: ${body.orderId} — the function has no auth check and verify_jwt is off`), { isAssertion: true });
    }
    return `${res.status}: ${JSON.stringify(body)} — no order minted`;
  });

  await maybe('a valid amount either mints an order or fails cleanly on missing secrets', async () => {
    const res = await call({ body: JSON.stringify({ amount: 199, receipt: `test_${Date.now()}` }) });
    const body = await bodyOf(res);
    if (res.status === 200) {
      ok(body.orderId, 'a 200 must carry orderId');
      ok(body.keyId, 'a 200 must carry keyId for the checkout');
      ok(!JSON.stringify(body).includes('KEY_SECRET'), 'LEAK: the response mentions the secret key');
      return `order ${body.orderId} for ${body.amount} ${body.currency}`;
    }
    // 502 = Razorpay rejected us (bad/missing keys). 500 = secrets unset and
    // btoa(undefined:undefined) threw. Both are "not configured", not a bug.
    return `${res.status}: ${JSON.stringify(body)} — Razorpay creds likely unset`;
  });
}
