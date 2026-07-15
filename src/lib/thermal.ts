// ============================================================================
// Bluetooth thermal printer (ESC/POS) wrapper.
//
// Uses react-native-thermal-printer-driver for Bluetooth Classic / BLE / TCP.
// Falls back gracefully when the native module is unavailable (e.g. Expo Go).
// ============================================================================

let ThermalPrinter: any = null;
let PRINTER_COMMANDS: any = null;

try {
  // Dynamic require so the app doesn't crash if the native module isn't linked
  const mod = require('react-native-thermal-printer-driver');
  ThermalPrinter = mod.default ?? mod.ThermalPrinter ?? mod;
  PRINTER_COMMANDS = mod.COMMANDS ?? mod.PrinterCommands ?? {};
} catch {
  // Native module not available (e.g. running in Expo Go)
}

export function isThermalAvailable(): boolean {
  return ThermalPrinter != null;
}

export type PrinterDevice = {
  name: string;
  address: string; // MAC address or IP
};

/**
 * Get list of Bluetooth-paired devices. Returns empty array if unavailable.
 */
export async function scanBluetoothPrinters(): Promise<PrinterDevice[]> {
  if (!ThermalPrinter) return [];
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

/**
 * Print a formatted milk collection slip via ESC/POS over Bluetooth.
 */
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
  if (!ThermalPrinter) return { error: 'Thermal printer module not available' };

  try {
    await ThermalPrinter.connectBluetooth(printerAddress);

    // Build ESC/POS text
    const lines = [
      '\x1B\x61\x01', // center align
      '\x1B\x45\x01', // bold on
      `${data.societyName}\n`,
      '\x1B\x45\x00', // bold off
      '--------------------------------\n',
      '\x1B\x61\x00', // left align
      `Date: ${data.date}  ${data.session}\n`,
      `Member: ${data.memberName} (#${data.membercode})\n`,
      '--------------------------------\n',
      `Weight:   ${data.weight} L\n`,
      `Fat:      ${data.fat} %\n`,
      ...(data.snf ? [`SNF:      ${data.snf} %\n`] : []),
      `Rate:     Rs ${data.rate.toFixed(2)}\n`,
      '--------------------------------\n',
      '\x1B\x45\x01', // bold on
      `AMOUNT:   Rs ${data.amount.toFixed(2)}\n`,
      '\x1B\x45\x00', // bold off
      '--------------------------------\n',
      '\x1B\x61\x01', // center align
      'Thank you!\n\n\n',
      '\x1D\x56\x00', // paper cut (if supported)
    ];

    await ThermalPrinter.printText(lines.join(''));
    await ThermalPrinter.disconnect();
    return {};
  } catch (e: any) {
    try { await ThermalPrinter.disconnect(); } catch {}
    return { error: e?.message ?? String(e) };
  }
}

/**
 * Print a simple test page to verify the printer is working.
 */
export async function printTestPage(printerAddress: string): Promise<{ error?: string }> {
  if (!ThermalPrinter) return { error: 'Thermal printer module not available' };
  try {
    await ThermalPrinter.connectBluetooth(printerAddress);
    await ThermalPrinter.printText(
      '\x1B\x61\x01' + // center
      '\x1B\x45\x01' + // bold
      'PRINTER TEST\n' +
      '\x1B\x45\x00' + // bold off
      '--------------------------------\n' +
      'If you can read this,\nyour printer is working!\n' +
      '--------------------------------\n\n\n' +
      '\x1D\x56\x00' // cut
    );
    await ThermalPrinter.disconnect();
    return {};
  } catch (e: any) {
    try { await ThermalPrinter.disconnect(); } catch {}
    return { error: e?.message ?? String(e) };
  }
}
