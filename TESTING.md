# Testing

Automated tests for every API and its error paths. Node scripts — they never enter
the app bundle.

```bash
npm run test:api                               # everything (~162 tests, ~40s)
node scripts/api-tests/run.mjs auth rls        # named suites only
node scripts/api-tests/run.mjs --keep          # leave fixtures up to poke at
npm run test:api:sweep                         # delete leftover TEST_ data and exit
```

Suites: `auth`, `rls`, `constraints`, `sync`, `subscription`, `edge`.

Results print to the console and land in `scripts/api-tests/logs/run-<timestamp>.{json,md}`
(gitignored). The `.md` is a readable table; the `.json` is for diffing runs.

> **The in-app dev simulator lives on the `testing` branch, not here.** It is kept off
> `main` because `__DEV__` makes it unreachable in a release build but *not absent* —
> Metro doesn't tree-shake, so a top-level import would ship the module as dead code.
> Building from `main` is what keeps it out of the APK. See `DEV_TESTING.md` on that branch.

## Setup

Credentials come from **`.env.test`** (gitignored):

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...          # what the app uses; RLS applies
SUPABASE_SERVICE_ROLE_KEY=...  # bypasses RLS — fixtures/teardown only
```

> The service-role key bypasses every security rule in the project. Keep it on your
> machine only. If it ever reaches a repo, a build log, or a chat, rotate it in
> Supabase → Settings → API.

## This runs against the LIVE project

There is no staging project, so the suite runs against production — where real dairies
live. It is safe because of one rule, enforced in `lib/fixtures.mjs`:

**Everything created is tagged `TEST_<runid>`, and teardown only ever deletes by that tag.**

Teardown runs in a `finally`, so a crash still cleans up. If a run is killed hard
(`ctrl-C`), `--sweep` removes the leftovers. Verified: the societies table returns to
its exact pre-run contents.

Never widen a delete filter in `fixtures.mjs` — a stray `.neq()` would take out a
customer's collections.

One trap if you extend the fixtures: `on_auth_user_created` creates a **society per
signup**, with a random hex code. Creating a society *and* a user therefore leaves the
trigger's society orphaned and untaggable. The fixtures let the trigger make it, then
adjust it.

## What the suites cover

| Suite | Covers |
|---|---|
| `auth` | sign-in/up/out, wrong password, unknown user, weak password, duplicate signup, malformed email, forged/expired JWT, no apikey, the signup trigger, the no-trial rule, tenant isolation at signup |
| `rls` | anon read/write on every table; cross-tenant read/insert/update/delete for all 8 tenant tables; own-tenant positive path; privilege escalation; subscription self-extension; `app_config` writes |
| `constraints` | unique/not-null/FK/type violations, bad dates, unknown column/table, SQL injection, unicode, plus **gaps documented** where the DB accepts nonsense (negative weight, 999% fat, free-text `method`/`kind`) |
| `sync` | the exact `pushAll`/`pullAll` calls: `updated_at` cursor on all 6 tables, `client_id` round-trip, upsert idempotency (retry-safety), 500-row batching, atomic batch failure, edit/delete of synced rows, rate-chart backup/restore |
| `subscription` | server subscription facts, the lock predicate truth table, the approve/renew flow, the `is_active` kill switch |
| `edge` | `razorpay-order` validation and CORS — **currently skipped: not deployed** (nothing calls it; `SubscriptionScreen` uses UPI + manual approval) |

Tests assert **Postgres error codes** (`23505`, `42501`, …) rather than message text,
because messages get reworded between Supabase releases and codes don't. `auth` is the
deliberate exception: `LoginScreen` maps errors to its bilingual alerts by matching
strings, so those tests assert the strings. If Supabase rewords one, the test tells you
which alert silently degraded to a generic "Error".

### One thing to keep in sync

`suites/subscription.mjs` keeps its **own copy** of `computeLocked()`, because `src/`
can't be imported here (AsyncStorage/react-native). If you change the lock rule in
`src/lib/subscription.ts`, change the mirror too — otherwise the truth table happily
proves the old behaviour and tells you nothing.

## Reading a failure

- **`✗ fail`** — an assertion failed. Real finding.
- **`! error`** — the test itself threw (bug in the test, or the server was unreachable).
- Tests named **`DOCUMENTS GAP:`** pass either way. They record what the DB *does*, not
  what it *should* do — e.g. that nothing stops a negative milk weight.

## Known failures — unapplied migrations

As of the last run, **3 of 162 fail, and all 3 are the DB, not the tests.** Both
migrations are written but have not been run against the live project. Paste them into
Supabase Studio → SQL Editor:

| Failing test | Fix | Effect until applied |
|---|---|---|
| `A cannot escalate itself to super admin` | `supabase/migration_v7_profile_lockdown.sql` | **CRITICAL** — any signed-up user can set `is_super_admin=true`, then read/update every society and rewrite `app_config.upi_vpa` to redirect all subscription payments |
| `A cannot move its profile to another society` | same (v7) | **CRITICAL** — any user can repoint `society_id` at another dairy and read/write its farmers, bank accounts and collections. Confirmed end-to-end against live |
| `a new signup gets NO trial, so it starts LOCKED` | `supabase/migration_v8_no_trial.sql` | New dairies still receive a free 14-day trial from the column default. The client half is already in `src/lib/subscription.ts`, so this is server-side only |

Re-run `npm run test:api` after applying — all three should go green.
