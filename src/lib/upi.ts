// ============================================================================
// UPI deep-link helper.
//
// Builds a standard `upi://pay` intent URL. On Android this opens the phone's
// installed UPI app chooser (GPay / PhonePe / Paytm / BHIM…) with the payee and
// amount already filled in — the operator just confirms and enters their PIN.
//
// NOTE: UPI intents don't reliably return a result to the JS layer, so the
// screen asks the operator to confirm success and then records the payout.
// ============================================================================
import { Linking, Platform } from 'react-native';

export type UpiParams = {
  vpa: string;        // payee UPI id, e.g. 9876543210@ybl  (the "receiver")
  name: string;       // payee name
  amount: number;     // ₹
  note?: string;
};

/** Basic sanity check for a UPI id (looks like `something@handle`). */
export function isValidVpa(vpa: string): boolean {
  return /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim());
}

// The UPI deep-link spec has no "phone number" field — a payee is always a VPA.
// So when only a mobile number is known, we build a VPA as <number>@<handle>.
// `upi` is BHIM/NPCI's generic handle; change this to whatever most of your
// farmers use (e.g. 'ybl' = PhonePe, 'oksbi'/'okaxis' = GPay, 'paytm').
// It's pre-filled into an editable field so the operator can correct it.
export const DEFAULT_UPI_HANDLE = 'upi';

/** Keep the last 10 digits (drops +91 / leading 0 / spaces). */
export function normalizeMobile(m: string): string {
  const digits = (m || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function isValidMobile(m: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizeMobile(m));
}

/** Build a best-effort VPA from a phone number. */
export function phoneToVpa(mobile: string, handle: string = DEFAULT_UPI_HANDLE): string {
  return `${normalizeMobile(mobile)}@${handle}`;
}

export function buildUpiUrl({ vpa, name, amount, note }: UpiParams): string {
  const q = new URLSearchParams({
    pa: vpa.trim(),
    pn: name,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: note ?? 'Milk payment',
  });
  // Use %20 for spaces (some UPI apps render the "+" form literally).
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

/**
 * Open the UPI app with the payment prefilled.
 * Returns false if no UPI app could be opened (e.g. iOS / emulator).
 */
export async function openUpiPayment(params: UpiParams): Promise<boolean> {
  const url = buildUpiUrl(params);
  try {
    // On Android, launching the upi:// intent shows the app chooser directly.
    if (Platform.OS === 'android') {
      await Linking.openURL(url);
      return true;
    }
    // iOS: UPI apps use their own schemes; the generic intent may not resolve.
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
