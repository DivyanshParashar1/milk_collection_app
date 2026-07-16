import { NativeModule, requireOptionalNativeModule } from 'expo';

export type BondedPrinter = {
  name: string;
  address: string; // MAC, e.g. "66:22:5A:11:2C:8F"
};

declare class ThermalPrinterModule extends NativeModule<{}> {
  /** Does this device have Bluetooth hardware at all? */
  isAvailable(): boolean;
  /** Is Bluetooth switched on right now? */
  isEnabled(): Promise<boolean>;
  /** Devices already paired in Android settings. */
  getBondedPrinters(): Promise<BondedPrinter[]>;
  /** Write raw ESC/POS bytes to a paired printer. Rejects with a readable message. */
  printBytes(address: string, bytes: number[]): Promise<boolean>;
}

// Optional on purpose: in Expo Go (or on web) the native module isn't linked and
// this returns null instead of throwing, so callers degrade rather than crash.
export default requireOptionalNativeModule<ThermalPrinterModule>('ThermalPrinter');
