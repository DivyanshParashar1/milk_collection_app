# MilkApp — Phased Roadmap

Status of the React Native rebuild and what's left, in build order.
Legend — effort: **S** ≈ 0.5–1 day · **M** ≈ 2–4 days · **L** ≈ 1–2 weeks.
Each phase lists scope, any DB/migration changes, dependencies, and "done when".

---

## ✅ Phase 0 — Foundation & core loop (DONE)

Shipped and verified (typecheck + bundle + logic tests):

- **Auth** — Supabase email/password, profile → society, RLS multi-tenant.
- **Farmers** — list, search, detail (balance + history), add/edit.
- **Rate chart editor** — Simple (₹/fat-point) + Custom table; floor-match lookup.
- **Milk collection** — auto rate/price/kg-fat/SNF; history; edit & delete (remote-safe).
- **Payouts** — Cash + UPI deep-link (payee prefilled); mobile-number fallback (`<number>@handle`).
- **Reports** — period presets, totals, session split, payout split, per-farmer table.
- **Settings** — dairy name, UPI handle, rounding, AM/PM cutoff, auto-print (on-device).
- **Printing / export** — thermal slip (expo-print) + report PDF share (expo-sharing).
- **Rate chart cloud** — backup / restore to Supabase.
- **Subscription** — Razorpay (app licensing only, via Edge Function).
- **Offline-first sync** — local SQLite → Supabase push with dirty-row flags.

---

## 🔜 Phase 1 — Two-way sync & multi-device  *(effort: L)*

Right now sync only **pushes**. Make data flow both ways so office/second device stay current.

- Initial **download** on login (members, rate chart, recent collections/payouts).
- **Pull** new/updated server rows on each sync; merge into local SQLite.
- Conflict rule: last-write-wins via `updated_at`; keep it simple and documented.
- Sync status UI (last-synced time, per-table counts, auto-sync on connectivity).
- Idempotent upserts — add a stable `client_id` (uuid) to collections/payouts so re-sync never duplicates.

**DB / migration:** add `client_id uuid` + `updated_at` to `milk_collections`, `payouts`, `members`; unique `(society_id, client_id)`.
**Depends on:** Phase 0. **Done when:** two devices on the same society converge to identical data after each syncs.

---

## 🔜 Phase 2 — Ledger & deductions (accounting completeness)  *(effort: M)*

Farmer balance today = milk value − payouts. Real dairies also have advances, loans, and deductions.

- **Jama/Udhar** (credit/debit notes) — screen + `ledger_entries` (table already in schema).
- **Deductions ("Kapat")** — feed, loan EMI, society charges; per-farmer and bulk.
- **Passbook** — unified per-farmer statement: milk + credits − debits − payouts = balance.
- Fold ledger into the balance used by Payout and Farmer detail.

**DB / migration:** wire up existing `ledger_entries`; add a `deductions` table (or reuse ledger with a `kind`).
**Depends on:** Phase 1 (so ledger syncs). **Done when:** a farmer's passbook reconciles to their payable balance.

---

## 🔜 Phase 3 — Sales modules  *(effort: L)*

The original app sells milk & goods, not just collects. Three sub-modules:

- **Local sale** — direct-to-consumer milk; own rate table; daily bill; SMS/print receipt.
- **Item / shop sale** — cattle feed & goods; item master, stock, per-item passbook.
- **Union sale** — bulk dispatch to the union/dairy; tanker/lot records.

**DB / migration:** `local_sale`, `local_sale_rate`, `items`, `item_sales`, `union_sales` (+ RLS).
**Depends on:** Phase 0. **Done when:** a local sale and an item sale can be recorded, billed, and reported.

---

## 🔜 Phase 4 — Reports expansion  *(effort: M)*

Beyond the current summary report:

- **Payment / bonus report** — per-farmer payable for a cycle (e.g. 10-day), with bonus rules.
- **P&L** — purchase vs sale, margins.
- **Date-wise & bill summaries**, deduction (kapat) reports.
- **Cycle statement PDF** per farmer (printable/shareable), bulk export.

**DB / migration:** none (query layer). **Depends on:** Phases 2–3 for full numbers. **Done when:** operator can generate & share a cycle payment statement.

---

## 🔜 Phase 5 — Hardware & field UX  *(effort: L, needs devices)*

- **Dedicated ESC/POS Bluetooth printing** — direct thermal driver for cheap 58mm printers (beyond the OS print sheet).
- **Milk analyzer input** — read fat/SNF/CLR over USB/Bluetooth serial (Ekomilk/Lactoscan-style).
- **Weighing scale** integration (serial).
- **Fingerprint login** (expo-local-authentication).

**Dependencies:** dev-client build required; physical printer + analyzer to verify. **Done when:** a collection reads fat from the analyzer and prints on the BT thermal printer end-to-end.

---

## 🔜 Phase 6 — Multi-user, roles & licensing  *(effort: M)*

- **Roles** — operator vs admin (RLS policies per role).
- **Multiple operators** per society; per-operator report attribution.
- **Society activation / license** gating tied to the Razorpay subscription (block writes when lapsed).
- Optional **admin dashboard** (web) for society owners.

**DB / migration:** `profiles.role` policies; `subscription_status` on society. **Depends on:** Phase 1. **Done when:** an expired subscription blocks new entries; admin sees all operators' data.

---

## 🔜 Phase 7 — Localization & accessibility  *(effort: S–M)*

- Proper **i18n** framework (replace ad-hoc bilingual strings).
- More Indian languages (Marathi, Gujarati, Telugu, …).
- Large-text / high-contrast mode; optional voice prompts for low-literacy users.

**Depends on:** none (do anytime). **Done when:** language switch in Settings changes the whole UI.

---

## 🔜 Phase 8 — Production hardening & release  *(effort: M)*

- **Error monitoring** (Sentry) + graceful offline/error states everywhere.
- **RLS audit** and a security pass (see original `security-review`).
- **Automated tests** for the calc engine, sync, and ledger math.
- **EAS build & Play Store release**; app icon/splash/branding.
- **Backup / restore** of the full local DB; data export.
- Razorpay **live keys** + webhook to confirm payments server-side.

**Done when:** a signed release build is on the Play Store with monitoring and confirmed payments.

---

## Cross-cutting / tech debt (address as you go)

- Move ad-hoc `any` navigation typing to a typed param list.
- Centralize the sync engine (push+pull) instead of per-feature calls.
- Decide day-boundary policy (currently UTC `YYYY-MM-DD`) — switch to IST consistently if needed.
- Per-animal (cow/buff) rate charts (schema supports `animal_type`; UI is single-chart today).
- Cloud sync for app settings (currently device-local).

## Suggested next

**Phase 1 (two-way sync)** — it's the biggest reliability unlock and everything else (ledger, sales, roles) benefits from data flowing both ways.
