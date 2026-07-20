// ============================================================================
// Dynamic Expo config — middleware over the static app.json.
//
// Everything except the version still lives in app.json. `version` and
// `android.versionCode` come from version.json, which src/lib/version.ts also
// reads, so the number baked into the APK and the number the app shows in
// Settings are the same constant and a release means editing one file.
//
// version.json rather than a .ts module because Expo transpiles this config
// file on its own — a relative import of a .ts file from here cannot be
// resolved at build time, but JSON can.
//
// This is why app.json no longer has a "version" key — don't add it back.
// ============================================================================
import { ExpoConfig, ConfigContext } from 'expo/config';
import versionInfo from './version.json';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Neerja Milk Collection',
  slug: config.slug ?? 'milk-app',
  version: versionInfo.version,
  android: {
    ...config.android,
    versionCode: versionInfo.androidVersionCode,
  },
});
