# Testing

Two things live here:

1. **`scripts/api-tests/`** — automated tests for every API, including its error paths.
2. **`src/screens/DevScreen.tsx`** — a temporary in-app simulator for manual testing.

---

## 1. API tests

```bash
node scripts/api-tests/run.mjs                 # everything (~160 tests, ~40s)
node scripts/api-tests/run.mjs auth rls        # named suites only
node scripts/api-tests/run.mjs --keep          # leave fixtures up to poke at
node scripts/api-tests/run.mjs --sweep         # delete leftover TEST_ data and exit
```

Suites: `auth`, `rls`, `constraints`, `sync`, `subscription`, `edge`.

Results print to the console and are written to `scripts/api-tests/logs/run-<timestamp>.{json,md}`
(gitignored). The `.md` is a readable table; the `.json` is for diffing runs.

### Setup

Credentials come from **`.env.test`** (gitignored, already created):

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...          # what the app uses; RLS applies
SUPABASE_SERVICE_ROLE_KEY=...  # bypasses RLS — fixtures/teardown only
```

> The service-role key bypasses every security rule in the project. Keep it on your
> machine only. If it ever reaches a repo, a build log, or a chat, rotate it in
> Supabase → Settings → API.

### This runs against the LIVE project

There is no staging project, so the suite runs against production — where 7 real
dairies live. It is safe because of one rule, enforced in `lib/fixtures.mjs`:

**Everything created is tagged `TEST_<runid>`, and teardown only ever deletes by that tag.**

Teardown runs in a `finally`, so a crash still cleans up. If a run is killed hard
(`ctrl-C`), `--sweep` removes the leftovers. Both were verified: the societies table
returns to exactly 7 rows after a run.

One trap worth knowing if you extend the fixtures: the `on_auth_user_created`
trigger creates a **society per signup**, with a random hex code. So creating a
society *and* a user leaves the trigger's society orphaned and untaggable. The
fixtures therefore let the trigger make the society and then adjust it.

### What the suites cover

| Suite | Covers |
|---|---|
| `auth` | sign-in/up/out, wrong password, unknown user, weak password, duplicate signup, malformed email, forged/expired JWT, no apikey, the signup trigger, the no-trial lockdown for new signups, tenant isolation at signup |
| `rls` | anon read/write on every table; cross-tenant read/insert/update/delete for all 8 tenant tables; own-tenant positive path; privilege escalation; subscription self-extension; `app_config` writes |
| `constraints` | unique/not-null/FK/type violations, bad dates, unknown column/table, SQL injection, unicode, plus **gaps documented** where the DB accepts nonsense (negative weight, 999% fat, free-text `method`/`kind`) |
| `sync` | the exact `pushAll`/`pullAll` calls: `updated_at` cursor on all 6 tables, `client_id` round-trip, upsert idempotency (retry-safety), 500-row batching, atomic batch failure, edit/delete of synced rows, rate-chart backup/restore |
| `subscription` | server subscription facts, the lock predicate truth table (8 cases + 2 edge cases), the approve/renew flow, the `is_active` kill switch |
| `edge` | `razorpay-order` validation and CORS — **currently skipped: the function is not deployed** (nothing in the app calls it; `SubscriptionScreen` uses UPI + manual approval) |

Tests assert **Postgres error codes** (`23505`, `42501`, …) rather than message text,
because messages get reworded between Supabase releases and codes don't. The `auth`
suite is the exception: it asserts message text *on purpose*, because `LoginScreen`
maps errors to its bilingual alerts by matching strings. If Supabase rewords one,
that test tells you which alert silently degraded to a generic "Error".

### Reading a failure

- **`✗ fail`** — an assertion failed. Real finding.
- **`! error`** — the test itself threw (bug in the test, or the server was unreachable).
- Tests named **`DOCUMENTS GAP:`** pass either way. They record what the DB *does*,
  not what it *should* do — e.g. that nothing stops a negative milk weight.

---

## 2. Dev simulator (temporary — this branch only)

Open the app in development → red **🧪 DEV** tile on the Home grid.

**This lives on the `testing` branch and is deliberately absent from `main`.** Don't
merge this branch into main as-is; cherry-pick from it, or rebase it forward when you
need the simulator again.

### Why it is not on main

Both the tile and the route are wrapped in `__DEV__`, which makes them **unreachable**
in a release build — but that is not the same as absent. Verified by exporting both
modes with `--no-bytecode` and grepping the bundles:

| string | prod bundle | dev bundle |
|---|---|---|
| `"Dev Simulator"` (route title) | absent | PRESENT |
| `"simulator"` (Home tile) | absent | PRESENT |
| `navigate("Dev")` | no call sites | PRESENT |
| `"Probe EVERY guarded write"` (DevScreen body) | **PRESENT** | PRESENT |
| `"WIPE local database"` (DevScreen body) | **PRESENT** | PRESENT |

So the entry points strip correctly and nobody can open the screen, but the module
itself still ships: Metro does not tree-shake, so the top-level
`import DevScreen from './src/screens/DevScreen'` in App.tsx keeps it in the graph as
dead code (~26KB of a 1.7MB bundle). Keeping the branch off main is what actually
keeps it out of the APK.

To re-check after any change:

```bash
npx expo export --platform android --no-bytecode --output-dir /tmp/prod-js
grep -c "Probe EVERY guarded write" /tmp/prod-js/_expo/static/js/android/*.js   # want: 0 on main
```

### What it does

- **Current state** — session, society id, pending sync rows, and the lock read three
  ways: `useSubscription().locked` (what screens use), `isLockedNow()` (the cached
  flag writes actually check), and a fresh `computeLocked()`. It flags when the cached
  value has gone stale, and when local settings disagree with the server.
- **Simulate subscription state** — one tap for: active, expires in 2 min, expired 1
  min ago, expired 5 days, disabled by admin, fresh install, corrupt date. Each row
  shows the lock result it should produce.
- **Test the lock** — fire the real `guard()` alert, or **probe every guarded write**:
  it calls all 13 write functions in `db.ts` while locked and reports which ones write
  anyway. Junk rows are cleaned up afterwards.
- **Sync** — `pushAll()`, `pullAll()`, reset the pull cursor, and see the real
  offline error text.
- **Local data** — seed 5 farmers + 10 collections, delete them, mark everything
  unsynced, wipe the local DB, reset settings.
- **Jump to a screen** — every route, so you can set an expired state and then try to
  save on each entry screen.

### The one thing to know

**Simulated subscription states are local and temporary.** `pullAll()` overwrites
`subscriptionEnd`/`isActive` from the server on every pull, and `App.tsx` pulls
whenever the app returns to the foreground. So a simulated expiry survives until the
next sync or foreground, then snaps back to the server's value. The page shows a
drift warning when local and server disagree.

To test a *durable* expiry, change the server instead — Super Admin → Disable, or set
`subscription_end_date` in the past in Supabase Studio.

### Suggested manual passes

**Lockout**
1. Simulate *EXPIRED · 5 days ago*. Home entry tiles show 🔒.
2. Open Milk Collection → Save → expect the bilingual alert, not a saved row.
3. Repeat for Payout, Ledger, Local Sale, Union Sale.
4. Confirm reports/history still open and render — browsing must stay allowed.
5. Run **Probe every guarded write** → expect "all writes blocked".
6. Simulate *Active · 30 days* → the same save now succeeds.

**Renewal**
1. Simulate *EXPIRED*, confirm locked.
2. On another device/account, Super Admin → Approve the request (or +30 Days).
3. Back on the locked device: background → foreground. The pull lands, the lock lifts.
   This is why sync is exempt from the lock: it is the only way back.

**Offline**
1. Turn on airplane mode, save a collection → stays local, pending count rises.
2. Back online → `pushAll()` → pending returns to 0, no duplicates.
3. Press `pushAll()` twice in a row → still no duplicates (that's `client_id`).

---

## Removing the dev page

Already done: **build releases from `main`, which does not contain it.** That is the
whole reason for the branch split — see "Why it is not on main" above.

If you ever merge this branch forward and want the page gone again, it is three files:

1. `rm src/screens/DevScreen.tsx`
2. `App.tsx` — remove the `DevScreen` import and the `{__DEV__ && <Stack.Screen name="Dev" …>}` block.
3. `src/screens/HomeScreen.tsx` — remove the `{__DEV__ && …}` DEV tile block.

`npx tsc --noEmit` confirms nothing else referenced it, and the `grep` above confirms
the bundle is clean. The API tests (`scripts/api-tests/`) are **not** part of this —
they live on `main` and never enter the app bundle.
