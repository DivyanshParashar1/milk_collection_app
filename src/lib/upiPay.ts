// ============================================================================
// UPI subscription payment (no gateway).
//
// The dairy pays the app owner directly over UPI, then raises a request that a
// Super Admin approves to extend the subscription. The payee UPI ID lives in
// the global `app_config` table so the admin can change it without an app update.
// ============================================================================
import { supabase } from './supabase';

export const DEFAULT_VPA = '7737115459@upi';
export const DEFAULT_PAYEE = 'Neerja Milk Collection';

export type PayConfig = { vpa: string; payeeName: string };

/** Read the payee UPI ID from app_config (falls back to the defaults). */
export async function getPayConfig(): Promise<PayConfig> {
  try {
    const { data } = await supabase
      .from('app_config')
      .select('upi_vpa, upi_payee_name')
      .eq('id', 1)
      .single();
    return {
      vpa: data?.upi_vpa || DEFAULT_VPA,
      payeeName: data?.upi_payee_name || DEFAULT_PAYEE,
    };
  } catch {
    return { vpa: DEFAULT_VPA, payeeName: DEFAULT_PAYEE };
  }
}

/** Super-admin only: update the payee UPI ID. */
export async function setPayConfig(vpa: string, payeeName: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('app_config')
    .upsert({ id: 1, upi_vpa: vpa.trim(), upi_payee_name: payeeName.trim(), updated_at: new Date().toISOString() });
  return { error: error?.message };
}

/** Build a UPI deep link that opens the user's UPI app pre-filled to pay. */
export function buildUpiUrl(cfg: PayConfig, amount: number, note: string): string {
  const q = [
    `pa=${encodeURIComponent(cfg.vpa)}`,
    `pn=${encodeURIComponent(cfg.payeeName)}`,
    `am=${encodeURIComponent(String(amount))}`,
    `cu=INR`,
    `tn=${encodeURIComponent(note)}`,
  ].join('&');
  return `upi://pay?${q}`;
}

// ---------------------------------------------------------------- plans
// Price and duration live together so they cannot drift apart: planDays() is
// what SuperAdminScreen.approve() bills against, and it must know every id here.

export type Plan = {
  id: string;
  label: string;
  sub: string;
  price: number;  // what the dairy actually pays today
  mrp?: number;   // struck-through "before" price, when the plan is discounted
};

/** A dairy's first ever subscription: one year, one price, no alternative. */
export const FIRST_YEAR_PLAN: Plan = {
  id: 'first_year',
  label: 'First year',
  sub: '12 months · one-time joining plan',
  price: 2000,
};

/** Everything a dairy that has already subscribed once can buy. */
export const RENEWAL_PLANS: Plan[] = [
  { id: 'monthly', label: 'Monthly', sub: '1 month', price: 80 },
  { id: 'yearly', label: 'Yearly', sub: '12 months · limited-time offer', price: 500, mrp: 600 },
];

/** The plans a dairy may choose from. A first-timer gets exactly one. */
export function plansFor(firstTime: boolean): Plan[] {
  return firstTime ? [FIRST_YEAR_PLAN] : RENEWAL_PLANS;
}

/** How many days a plan adds to the subscription when approved. */
export function planDays(planId: string): number {
  return planId === 'yearly' || planId === 'first_year' ? 365 : 30;
}

/** The society this user belongs to, or null. */
async function currentSocietyId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return null;
  const { data: prof } = await supabase.from('profiles').select('society_id').eq('id', uid).single();
  return prof?.society_id ?? null;
}

/**
 * Has this dairy never subscribed? `societies.subscription_end_date` is the flag:
 * migration v8 creates it null and approve() always writes a date, so null means
 * "never paid" and survives a lapse — a dairy gets the joining price once, ever.
 *
 * Read live from the server rather than from cached settings, because this
 * decides a price. There is no offline answer on purpose: paying by UPI and
 * raising the request both need the network anyway, so a screen that cannot
 * reach the server cannot price honestly and says so instead of guessing.
 */
export async function isFirstTimeCustomer(): Promise<{ firstTime?: boolean; error?: string }> {
  const societyId = await currentSocietyId();
  if (!societyId) return { error: 'No dairy is linked to your account yet.' };

  const { data, error } = await supabase
    .from('societies')
    .select('subscription_end_date')
    .eq('id', societyId)
    .single();
  if (error) return { error: error.message };
  return { firstTime: data?.subscription_end_date == null };
}

/**
 * Record a "please activate me" request for the current user's society.
 * Stored in `payments` with status 'requested' so a Super Admin can approve it.
 */
export async function raiseSubscriptionRequest(
  plan: Plan,
  note: string
): Promise<{ error?: string }> {
  const societyId = await currentSocietyId();
  if (!societyId) return { error: 'No dairy is linked to your account yet.' };

  const { error } = await supabase.from('payments').insert({
    society_id: societyId,
    amount: plan.price,
    purpose: 'subscription',
    plan: plan.id,
    status: 'requested',
    note,
  });
  return { error: error?.message };
}
