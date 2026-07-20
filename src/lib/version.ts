// ============================================================================
// Single source of truth for the app's version.
//
// The numbers live in version.json at the project root, NOT here, because
// app.config.ts has to read them too — and Expo transpiles the config file
// alone, so a relative import of a .ts module from it fails to resolve at
// build time. JSON is the one format both sides can load.
//
// Edit version.json. This file only re-exports it with types.
//
// RELEASE RULES (v1.0.0 is already in the field and cannot be recalled):
//
//   1. Bump `version` on every release. Patch = fix, minor = new feature,
//      major = a break we cannot avoid.
//   2. Bump `androidVersionCode` by exactly 1 on EVERY build that leaves this
//      machine. Android refuses to install an APK whose code is <= the
//      installed one, so a repeated code means users silently can't update.
//   3. Add a CHANGELOG.md entry in the same commit.
//   4. Supabase migrations must be ADDITIVE ONLY — new tables, or new columns
//      with a default. Never rename, never drop, never tighten a NOT NULL on
//      an existing column. v1.0.0 devices keep talking to the same database
//      forever and will send payloads that know nothing about new columns.
// ============================================================================
import versionInfo from '../../version.json';

export const APP_VERSION: string = versionInfo.version;

/** Must increase by 1 per build. Android will not install a lower/equal code. */
export const ANDROID_VERSION_CODE: number = versionInfo.androidVersionCode;

/**
 * Local SQLite schema version. Bumped whenever MIGRATIONS in db.ts gains a
 * step, so an existing install upgrading in place applies only the steps it is
 * missing instead of re-running every ALTER on every launch.
 */
export const SCHEMA_VERSION: number = versionInfo.schemaVersion;

/** Shown in Settings, e.g. "v1.1.0 (2)". */
export const VERSION_LABEL = `v${APP_VERSION} (${ANDROID_VERSION_CODE})`;
