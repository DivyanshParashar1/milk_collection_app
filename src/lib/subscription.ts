// ============================================================================
// Subscription lock — single source of truth for "can this device write?".
//
// There is no trial. A dairy writes only while it holds a paid, unexpired
// subscription; a brand-new signup and a lapsed one sit in the same locked
// state. The app stays fully browsable either way: every screen opens and
// every report renders, but no business data can be created or changed.
//
// Two layers, deliberately:
//   1. `useSubscription()` in screens, so an action gives a friendly bilingual
//      alert instead of an exception.
//   2. `assertUnlocked()` inside db.ts writes, as a backstop so a handler that
//      forgets the check still cannot mutate data.
//
// Sync is exempt on purpose. `upsert*FromServer` never calls assertUnlocked(),
// because pulling is how a renewal reaches the device — locking it would strand
// the user with no way back.
// ============================================================================
import { getSettings } from './settings';

export class SubscriptionLockedError extends Error {
  constructor() {
    super('No active subscription — data entry is locked.');
    this.name = 'SubscriptionLockedError';
  }
}

// Cached so writes stay synchronous and cheap; refreshed on app start, on
// foreground, and after every pull (see SubscriptionContext). Starts locked so
// the window before that first refresh fails closed — computeLocked() falls back
// to DEFAULT_SETTINGS (no end date → locked) if settings are unreadable, so this
// cannot strand a subscriber who would otherwise have unlocked.
let locked = true;

export function isLockedNow(): boolean {
  return locked;
}

export async function computeLocked(): Promise<boolean> {
  const s = await getSettings();
  // Unlocked needs positive proof of a subscription, so a missing end date locks
  // rather than opens. That covers the two ways a device legitimately has no
  // date: a fresh install that has not pulled yet, and a new signup, whose
  // societies row is created with a null end date (migration v8 — no trial).
  if (!s.subscriptionEnd) return true;
  const expired = Date.now() > new Date(s.subscriptionEnd).getTime();
  return s.isActive === false || expired;
}

export async function refreshLock(): Promise<boolean> {
  locked = await computeLocked();
  return locked;
}

export function assertUnlocked(): void {
  if (locked) throw new SubscriptionLockedError();
}
