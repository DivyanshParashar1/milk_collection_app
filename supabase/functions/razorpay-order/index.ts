// ============================================================================
// Supabase Edge Function: razorpay-order
// Creates a Razorpay order server-side so the secret key never ships in the app.
// Deploy:  supabase functions deploy razorpay-order
// Secrets: supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
// ============================================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID')!;
const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { amount, currency = 'INR', receipt, notes } = await req.json();
    if (!amount || amount <= 0) {
      return json({ error: 'amount (in rupees) required' }, 400);
    }

    const auth = 'Basic ' + btoa(`${KEY_ID}:${KEY_SECRET}`);
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // Razorpay works in paise
        currency,
        receipt: receipt ?? `rcpt_${Date.now()}`,
        notes: notes ?? {},
      }),
    });
    const order = await res.json();
    if (!res.ok) return json({ error: order?.error?.description ?? 'razorpay error', raw: order }, 502);

    // return only what the client needs
    return json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: KEY_ID });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
