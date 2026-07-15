// ============================================================================
// Per-device app settings (stored in AsyncStorage — no server round-trip).
// ============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppSettings = {
  societyName: string;      // dairy name shown on printed slips / reports
  upiHandle: string;        // default UPI handle used when only a mobile number is known
  rounding: 0 | 1 | 2;      // amount rounding: 0 = 2 decimals, 1 = 1 decimal, 2 = whole ₹
  amCutoffHour: number;     // before this hour (24h) the default session is Morning
  autoPrintSlip: boolean;   // print a slip automatically after each collection
};

export const DEFAULT_SETTINGS: AppSettings = {
  societyName: 'My Dairy',
  upiHandle: 'upi',
  rounding: 0,
  amCutoffHour: 14,
  autoPrintSlip: false,
};

const KEY = 'app_settings_v1';

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}
