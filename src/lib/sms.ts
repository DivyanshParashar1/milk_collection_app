// ============================================================================
// SMS helper — opens the native SMS composer with a pre-filled message.
// Uses expo-sms for reliable cross-platform behavior.
// ============================================================================
import * as SMS from 'expo-sms';

export type SlipData = {
  societyName: string;
  date: string;
  session: string; // 'Morning' | 'Evening'
  memberName: string;
  membercode: number;
  weight: number;
  fat: number;
  snf?: number;
  rate: number;
  amount: number;
};

export function collectionSmsBody(d: SlipData): string {
  return [
    `🥛 ${d.societyName}`,
    `Date: ${d.date} · ${d.session}`,
    `Member: ${d.memberName} (#${d.membercode})`,
    `Weight: ${d.weight}L · Fat: ${d.fat}%${d.snf ? ` · SNF: ${d.snf}%` : ''}`,
    `Rate: ₹${d.rate.toFixed(2)}/L`,
    `Amount: ₹${d.amount.toFixed(2)}`,
    `Thank you! 🙏`,
  ].join('\n');
}

/**
 * Opens the device's SMS app with a pre-filled message.
 * Returns true if the SMS composer was shown, false if SMS is unavailable.
 */
export async function openCollectionSms(
  mobile: string,
  data: SlipData
): Promise<boolean> {
  const available = await SMS.isAvailableAsync();
  if (!available) return false;

  const { result } = await SMS.sendSMSAsync(
    [mobile],
    collectionSmsBody(data)
  );
  // result is 'sent' | 'cancelled' | 'unknown' — Android usually returns 'unknown'
  return true;
}
