# Changelog

All notable changes to Neerja Milk Collection.

Versions follow [semver](https://semver.org/): MAJOR.MINOR.PATCH. The number in
brackets is the Android `versionCode`, which increases by 1 on every build.

> **v1.0.0 is in production and cannot be recalled.** Every database change
> from here on must be additive, so devices still running an older APK keep
> working against the same Supabase project. See `src/lib/version.ts`.

## [1.1.0] (2) — 2026-07-20

### Added

- **Union sale is now priced on fat**, not per litre. Enter a ₹-per-fat-point
  rate; the amount is `quantity × fat% × rate`. The old per-litre basis is still
  available on a toggle for unions that pay flat.
- **Union rate is remembered.** The fat rate and union name are saved once on
  the new "Union Rates" screen and auto-filled into every sale after that.
- **Routine Sale** — daily home delivery to known customers, under the Local
  Sale button alongside the existing walk-in sale.
  - Customer master with mobile, address, milk type, own rate, and separate
    morning/evening delivery toggles and quantities.
  - Daily checklist per session; tap a row to reveal the customer's mobile
    number and call them.
  - Monthly statement per customer with litres, amount, payments received and
    outstanding balance.
- App version is shown in Settings.

### Changed

- The Local Sale tile now opens a chooser with **Local Sale** (walk-in) and
  **Routine Sale**. The walk-in screen itself is unchanged.

### Database

- New tables: `routine_customers`, `routine_deliveries`, `routine_payments`,
  `union_sale_rates`.
- New columns: `union_sales.rate_basis`, `union_sales.fat_rate`.
- Existing rows and older app versions are unaffected — `rate_basis` defaults to
  `'litre'`, which is exactly how v1.0.0 wrote them.

## [1.0.0] (1) — 2026-07-16

First production release: farmers, milk collection, rate chart, payouts
(cash/UPI), ledger, deductions, local and union sale, inventory, reports,
thermal slip printing, offline sync, subscription.
