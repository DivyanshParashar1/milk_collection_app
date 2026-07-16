// ============================================================================
// Bluetooth Classic (SPP) thermal printer — ESC/POS.
//
// Backed by our own local Expo module (modules/thermal-printer). The npm
// options were all dead ends: none declared an AGP 8 `namespace`, so none of
// them build against Expo SDK 57 / RN 0.86, and all were legacy bridge modules.
// Owning ~150 lines of Kotlin is cheaper than owning a fork of an abandoned one.
//
// The ESC/POS byte layout lives HERE, in JS, so the receipt can be changed
// without a native rebuild. The native side only opens a socket and writes.
//
// It's a native module, so it only works in a dev-client / release build made
// with `npx expo run:android` or an EAS build — NOT in Expo Go. Where the module
// isn't linked, `Printer` is null and every call degrades instead of crashing.
// ============================================================================
import { PermissionsAndroid, Platform } from 'react-native';
import Printer from '../../modules/thermal-printer/src/ThermalPrinterModule';

const CHARS_PER_LINE = 32; // 58mm ("2 inch") paper at font A

// ---------------------------------------------------------------------------
// ESC/POS command bytes
// ---------------------------------------------------------------------------
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const INIT = [ESC, 0x40]; // reset — clears whatever the last job left set
const ALIGN_LEFT = [ESC, 0x61, 0];
const ALIGN_CENTER = [ESC, 0x61, 1];
const BOLD_ON = [ESC, 0x45, 1];
const BOLD_OFF = [ESC, 0x45, 0];
const DOUBLE_ON = [GS, 0x21, 0x11]; // double width + height
const DOUBLE_OFF = [GS, 0x21, 0x00];
// Feed past the tear bar, then attempt a partial cut. Printers without a cutter
// ignore the cut; the feed is what makes the slip tearable either way.
const FEED_AND_CUT = [LF, LF, LF, GS, 0x56, 0x42, 0x00];

/**
 * Encode to single-byte ASCII.
 *
 * Thermal printers have no Devanagari font — a Hindi name would print as noise,
 * so anything outside printable ASCII becomes '?'. This is why the slip uses
 * `name` (Latin) rather than `name_local`.
 */
function encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    out.push(c >= 0x20 && c <= 0x7e ? c : 0x3f);
  }
  return out;
}

function textLine(text: string): number[] {
  return [...encode(text), LF];
}

/** `label` left, `value` hard against the right margin, padded to 32 columns. */
function twoCol(label: string, value: string): number[] {
  const gap = CHARS_PER_LINE - label.length - value.length;
  const line =
    gap >= 1
      ? label + ' '.repeat(gap) + value
      : `${label} ${value}`.slice(0, CHARS_PER_LINE); // too long: truncate, never wrap mid-total
  return textLine(line);
}

/** Wrap free text (a long farmer name) at the paper width. */
function wrapped(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += CHARS_PER_LINE) {
    out.push(...textLine(text.slice(i, i + CHARS_PER_LINE)));
  }
  return out;
}

const RULE = textLine('-'.repeat(CHARS_PER_LINE));

export type SlipInput = {
  societyName: string;
  date: string;
  session: string;
  /** Farmer's name. Omitted/empty for a walk-in. */
  memberName?: string;
  /** 0 or undefined = walk-in customer. */
  membercode?: number;
  weight: number;
  fat: number;
  snf?: number;
  rate: number;
  amount: number;
};

/**
 * Build the full receipt as ESC/POS bytes.
 *
 * Exported so the layout can be unit-tested without a printer — see the
 * escpos byte tests.
 */
export function buildCollectionSlipBytes(d: SlipInput): number[] {
  const isWalkIn = !d.membercode;

  return [
    ...INIT,
    ...ALIGN_CENTER,
    ...BOLD_ON,
    ...wrapped(d.societyName),
    ...BOLD_OFF,
    ...textLine(`${d.date}  ${d.session}`),
    ...ALIGN_LEFT,
    ...RULE,
    // A walk-in has no name or code to show; a registered farmer gets both.
    ...(isWalkIn
      ? textLine('Customer: Walk-in')
      : wrapped(`Member: ${d.memberName ?? ''} (#${d.membercode})`)),
    ...RULE,
    ...twoCol('Weight', `${d.weight.toFixed(2)} L`),
    ...twoCol('Fat', `${d.fat.toFixed(1)} %`),
    ...(d.snf && d.snf > 0 ? twoCol('SNF', `${d.snf.toFixed(1)} %`) : []),
    ...twoCol('Rate', `Rs ${d.rate.toFixed(2)}`),
    ...RULE,
    // The total is the one line that must survive a truncated print, so it gets
    // its own double-size line rather than sharing a two-column row.
    ...BOLD_ON,
    ...twoCol('AMOUNT', `Rs ${d.amount.toFixed(2)}`),
    ...BOLD_OFF,
    ...RULE,
    ...ALIGN_CENTER,
    ...textLine('Thank you'),
    ...ALIGN_LEFT,
    ...FEED_AND_CUT,
  ];
}

export function buildTestPageBytes(): number[] {
  return [
    ...INIT,
    ...ALIGN_CENTER,
    ...BOLD_ON,
    ...DOUBLE_ON,
    ...textLine('TEST'),
    ...DOUBLE_OFF,
    ...BOLD_OFF,
    ...RULE,
    ...textLine('If you can read this,'),
    ...textLine('your printer is working.'),
    ...RULE,
    ...textLine('58mm / 2 inch - 32 chars'),
    ...textLine('1234567890123456789012345678901'),
    ...ALIGN_LEFT,
    ...FEED_AND_CUT,
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type PrinterDevice = {
  name: string;
  address: string; // MAC address
};

/** True when the native module is linked and the device has Bluetooth. */
export function isThermalAvailable(): boolean {
  try {
    return !!Printer?.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Android 12+ needs BLUETOOTH_CONNECT at runtime before we may even read the
 * paired-device list. Below 31 the install-time permissions cover us.
 */
export async function ensureBluetoothPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return true;
  const perm = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (!perm) return true;
  try {
    if (await PermissionsAndroid.check(perm)) return true;
    const res = await PermissionsAndroid.request(perm, {
      title: 'Allow Bluetooth',
      message: 'Needed to send receipts to your thermal printer.',
      buttonPositive: 'Allow',
    });
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/**
 * Paired Bluetooth devices. Pairing itself stays in Android settings — this
 * only lists what's already bonded, so no scan permission is needed.
 * Returns [] when unavailable, matching the previous behaviour.
 */
export async function scanBluetoothPrinters(): Promise<PrinterDevice[]> {
  if (!isThermalAvailable()) return [];
  if (!(await ensureBluetoothPermission())) return [];
  try {
    return await Printer!.getBondedPrinters();
  } catch {
    return [];
  }
}

async function print(address: string, bytes: number[]): Promise<{ error?: string }> {
  if (!isThermalAvailable()) {
    return { error: 'Bluetooth printing needs the app build with the printer module (not Expo Go).' };
  }
  if (!address) return { error: 'No printer selected. Settings → Bluetooth Thermal Printer.' };
  if (!(await ensureBluetoothPermission())) return { error: 'Bluetooth permission denied.' };
  try {
    await Printer!.printBytes(address, bytes);
    return {};
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

/** Print a milk-collection slip over Bluetooth. */
export async function printCollectionSlipBT(
  printerAddress: string,
  data: SlipInput
): Promise<{ error?: string }> {
  return print(printerAddress, buildCollectionSlipBytes(data));
}

/** Print a test page to verify the printer works. */
export async function printTestPage(printerAddress: string): Promise<{ error?: string }> {
  return print(printerAddress, buildTestPageBytes());
}
