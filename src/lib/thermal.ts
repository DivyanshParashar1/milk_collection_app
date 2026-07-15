// ============================================================================
// Bluetooth thermal printer (ESC/POS) wrapper.
//
// Backed by `react-native-thermal-printer` (DantSu ESC/POS under the hood).
// It's a native module, so it only works in a dev-client / release build made
// with `npx expo run:android` or an EAS build — NOT in Expo Go. When the module
// isn't linked, every call degrades gracefully instead of crashing.
//
// Payload markup understood by the library:
//   [L] [C] [R]      → left / center / right align
//   <b>...</b>       → bold
//   \n               → new line
// ============================================================================

let ThermalPrinter: any = null;

try {
  // Dynamic require so the app doesn't crash if the native module isn't linked.
  const mod = require('react-native-thermal-printer');
  ThermalPrinter = mod.default ?? mod;
} catch {
  // Native module not available (e.g. running in Expo Go).
}

const CHARS_PER_LINE = 32; // 58mm paper
const LINE = '[C]--------------------------------\n';

export function isThermalAvailable(): boolean {
  return ThermalPrinter != null;
}

export type PrinterDevice = {
  name: string;
  address: string; // MAC address
};

/** List Bluetooth-paired devices. Returns [] when unavailable. */
export async function scanBluetoothPrinters(): Promise<PrinterDevice[]> {
  if (!ThermalPrinter?.getBluetoothDeviceList) return [];
  try {
    const devices = await ThermalPrinter.getBluetoothDeviceList();
    return (devices ?? []).map((d: any) => ({
      name: d.deviceName ?? d.name ?? 'Unknown',
      address: d.macAddress ?? d.address ?? '',
    }));
  } catch {
    return [];
  }
}

async function printPayload(macAddress: string, payload: string): Promise<{ error?: string }> {
  if (!ThermalPrinter?.printBluetooth) return { error: 'Thermal printer module not available' };
  try {
    await ThermalPrinter.printBluetooth({
      macAddress,
      payload,
      printerNbrCharactersPerLine: CHARS_PER_LINE,
      autoCut: true,
    });
    return {};
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

/** Print a formatted milk-collection slip over Bluetooth. */
export async function printCollectionSlipBT(
  printerAddress: string,
  data: {
    societyName: string;
    date: string;
    session: string;
    memberName: string;
    membercode: number;
    weight: number;
    fat: number;
    snf?: number;
    rate: number;
    amount: number;
  }
): Promise<{ error?: string }> {
  const payload =
    `[C]<b>${data.societyName}</b>\n` +
    LINE +
    `[L]Date: ${data.date}  ${data.session}\n` +
    `[L]Member: ${data.memberName} (#${data.membercode})\n` +
    LINE +
    `[L]Weight[R]${data.weight} L\n` +
    `[L]Fat[R]${data.fat} %\n` +
    (data.snf ? `[L]SNF[R]${data.snf} %\n` : '') +
    `[L]Rate[R]Rs ${data.rate.toFixed(2)}\n` +
    LINE +
    `[L]<b>AMOUNT</b>[R]<b>Rs ${data.amount.toFixed(2)}</b>\n` +
    LINE +
    `[C]Thank you!\n\n`;
  return printPayload(printerAddress, payload);
}

/** Print a simple test page to verify the printer works. */
export async function printTestPage(printerAddress: string): Promise<{ error?: string }> {
  const payload =
    `[C]<b>PRINTER TEST</b>\n` +
    LINE +
    `[C]If you can read this,\n` +
    `[C]your printer is working!\n` +
    LINE +
    `\n`;
  return printPayload(printerAddress, payload);
}
