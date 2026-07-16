// ============================================================================
// Subscription lock — single source of truth for "can this device write?".
//
// When a subscription lapses the app stays fully browsable: every screen opens
// and every report renders, but no business data can be created or changed.
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
    super('Subscription expired — data entry is locked.');
    this.name = 'SubscriptionLockedError';
  }
}

// Cached so writes stay synchronous and cheap; refreshed on app start, on
// foreground, and after every pull (see SubscriptionContext).
let locked = false;

export function isLockedNow(): boolean {
  return locked;
}

export async function computeLocked(): Promise<boolean> {
  const s = await getSettings();
  const expired = !!s.subscriptionEnd && Date.now() > new Date(s.subscriptionEnd).getTime();
  return s.isActive === false || expired;
}

export async function refreshLock(): Promise<boolean> {
  locked = await computeLocked();
  return locked;
}

export function assertUnlocked(): void {
  if (locked) throw new SubscriptionLockedError();
}
