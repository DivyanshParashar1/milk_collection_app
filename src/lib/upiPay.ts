// ============================================================================
// UPI subscription payment (no gateway).
//
// The dairy pays the app owner directly over UPI, then raises a request that a
// Super Admin approves to extend the subscription. The payee UPI ID lives in
// the global `app_config` table so the admin can change it without an app update.
// ============================================================================
import { supabase } from './supabase';

export const DEFAULT_VPA = '7737115459@upi';
export const DEFAULT_PAYEE = 'MilkApp';

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

/** How many days a plan adds to the subscription when approved. */
export function planDays(planId: string): number {
  return planId === 'yearly' ? 365 : 30;
}

/**
 * Record a "please activate me" request for the current user's society.
 * Stored in `payments` with status 'requested' so a Super Admin can approve it.
 */
export async function raiseSubscriptionRequest(
  plan: { id: string; price: number },
  note: string
): Promise<{ error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { error: 'Not signed in' };

  const { data: prof } = await supabase.from('profiles').select('society_id').eq('id', uid).single();
  const societyId = prof?.society_id;
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
