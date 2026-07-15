# Milestone 3 — Sync, SMS, Thermal Print, Union Sale, Payment Report

## Current State (after M1 + M2)
19 screens, offline-first with push-only sync, OS print dialog (no ESC/POS), no SMS integration.

---

## 1. Two-Way Sync (Server → Device Pull)

Currently only **push** (local → Supabase) works. We need **pull** so a second device / reinstall gets existing data.

### Approach
- Add `pullAll()` to [sync.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/sync.ts)
- For each table (`members`, `milk_collections`, `payouts`, `ledger_entries`, `local_sales`):
  - Track `last_pull_at` timestamp in AsyncStorage
  - Query Supabase for rows with `created_at > last_pull_at` (filtered by `society_id`)
  - Upsert into local SQLite (skip if `remote_id` already exists locally)
  - Update `last_pull_at`
- Pull runs: on login, on manual sync button, and on app foreground (debounced)
- Conflict strategy: **server wins** for pulled rows; local edits remain unsynced until pushed

### Files changed
- **[MODIFY]** [sync.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/sync.ts) — add `pullAll()`, `pullMembers()`, `pullCollections()`, etc.
- **[MODIFY]** [db.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/db.ts) — add `upsertFromServer*()` functions that INSERT OR IGNORE by remote_id
- **[MODIFY]** [HomeScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/HomeScreen.tsx) — sync button does `pushAll()` then `pullAll()`; show pull counts
- **[MODIFY]** [settings.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/settings.ts) — store `lastPullAt` timestamp

---

## 2. SMS + Bluetooth Thermal Printer on Collection Save

### 2a. SMS (via `expo-sms`)

When operator taps **"Save & Send"** on the milk collection screen:
1. Entry is saved to local DB (same as now)
2. `expo-sms` opens the native SMS composer with:
   - **To**: farmer's `mobile1` from the members table
   - **Body**: pre-written message like:
     ```
     🥛 My Dairy
     Date: 2026-07-15 · Morning
     Weight: 10.5L · Fat: 6.2%
     Rate: ₹49.60/L
     Amount: ₹520.80
     Thank you!
     ```
3. User just presses send in their SMS app — we don't auto-send (Android restriction)

#### Walk-in (no member code) — NO SMS
If no member code is entered, SMS button is hidden. Receipt only.

### Files changed
- **[NEW dep]** `expo-sms` — `npx expo install expo-sms`
- **[NEW]** [sms.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/sms.ts) — `openCollectionSms(mobile, slipData)` helper
- **[MODIFY]** [MilkCollectionScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/MilkCollectionScreen.tsx):
  - Change "Save & next" button to **"Save & Send"** (when member has mobile)
  - After save → open SMS composer → then print receipt
  - Add a plain **"Save"** button for walk-in / no-SMS cases
  - Allow saving without member code (walk-in mode)

### 2b. Bluetooth Thermal Printer (ESC/POS)

We need real ESC/POS commands sent over Bluetooth, not the OS print dialog.

#### Library choice: `react-native-thermal-printer-driver`
- Modern TurboModule, supports Bluetooth Classic + BLE + TCP
- Has Expo config plugin (works with dev-client builds)
- Android-focused (which is our target — dairy devices are Android)

### Architecture
- **[NEW]** [thermal.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/thermal.ts) — wrapper module:
  - `scanBluetoothPrinters()` → returns list of paired devices
  - `connectPrinter(address)` → connect to specific printer
  - `printCollectionSlip(slipData)` → generates ESC/POS commands (text, bold, cut)
  - `getConnectedPrinter()` / `disconnectPrinter()`
- **[MODIFY]** [SettingsScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/SettingsScreen.tsx) — add "Bluetooth Printer" section:
  - Scan for printers
  - Select & remember paired printer (stored in AsyncStorage)
  - Test print button
- **[MODIFY]** [MilkCollectionScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/MilkCollectionScreen.tsx) — after save, if BT printer is configured, auto-print via ESC/POS (replaces the current `expo-print` OS dialog)
- **[MODIFY]** [settings.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/settings.ts) — add `btPrinterAddress`, `btPrinterName` fields
- **[MODIFY]** [app.json](file:///Users/divyanshparashar/Desktop/daddy/milk-app/app.json) — add Bluetooth permissions + plugin config

> [!IMPORTANT]
> **Bluetooth thermal printing requires a dev-client build** (not Expo Go). Your current EAS preview build setup already supports this since you have `expo-dev-client` installed.

> [!WARNING]
> **Cannot test Bluetooth printing in Expo Go.** The current `expo-print` OS dialog fallback stays as backup for non-BT setups.

---

## 3. Walk-in Milk Collection (No Member Code)

Allow milk collection **without** entering a member code. For walk-in / non-regular farmers.

### Behavior
- Member code field becomes optional
- If empty → label shows "Walk-in customer"
- On save:
  - Saved to `milk_collections` with `membercode = 0` (special sentinel)
  - Receipt printed (thermal or OS dialog)
  - **No SMS** (no mobile number)
  - **No balance tracking** (walk-in has no account)
  - Still syncs to Supabase (for reporting)
- Walk-in entries show in reports as "Walk-in" instead of a member name

### Files changed
- **[MODIFY]** [MilkCollectionScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/MilkCollectionScreen.tsx) — make code optional, handle walk-in flow
- **[MODIFY]** [db.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/db.ts) — allow membercode=0, exclude from balance calculations

---

## 4. Union Sale

Dairy societies sell collected milk onwards to a milk union/federation. This is separate from local sales (which is retail).

### [NEW] [UnionSaleScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/UnionSaleScreen.tsx)
- Form: date, session (AM/PM), total quantity sent, fat %, SNF %, rate, amount
- Auto-calculate: amount = quantity × rate, kg_fat, kg_snf
- Daily/session summary at top
- Recent union sales list below

### [NEW] `union_sales` table (local SQLite + Supabase)
- `local_id, remote_id, sale_date, session, quantity, fat, snf, rate, amount, kg_fat, kg_snf, union_name, note, synced`

### Files changed
- **[MODIFY]** [db.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/db.ts) — `union_sales` table + CRUD
- **[MODIFY]** [sync.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/sync.ts) — push union sales
- **[NEW]** [UnionSaleScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/UnionSaleScreen.tsx)
- **[MODIFY]** [HomeScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/HomeScreen.tsx) — add Union Sale tile
- **[MODIFY]** [App.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/App.tsx) — register screen
- **[MODIFY]** [schema.sql](file:///Users/divyanshparashar/Desktop/daddy/milk-app/supabase/schema.sql) — add `union_sales` table + RLS

---

## 5. Payment Report (Farmer Period Bill)

A per-farmer statement for a date range — the most requested report type by dairy operators.

### [NEW] [PaymentReportScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/PaymentReportScreen.tsx)
- Select farmer (code) + date range (from/to)
- Shows:
  - All milk collection entries in the period (date, session, weight, fat, rate, amount)
  - All deductions (kapat) applied
  - All payouts made
  - All ledger entries (jama/udhar)
  - **Net payable** = total milk value + jama − payouts − udhar − deductions
- Share as PDF (for printing / WhatsApp to farmer)

### Files changed
- **[MODIFY]** [db.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/db.ts) — `farmerPeriodReport(membercode, from, to)` query
- **[MODIFY]** [print.ts](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/lib/print.ts) — `paymentReportHtml()` + `exportPaymentReportPdf()`
- **[NEW]** [PaymentReportScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/PaymentReportScreen.tsx)
- **[MODIFY]** [ReportsScreen.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/src/screens/ReportsScreen.tsx) — add "Payment report" button
- **[MODIFY]** [App.tsx](file:///Users/divyanshparashar/Desktop/daddy/milk-app/App.tsx) — register screen

---

## Execution Order

1. **db.ts** — upsert-from-server helpers, union_sales table, farmerPeriodReport query, walk-in support
2. **sync.ts** — `pullAll()` + union sales push
3. **settings.ts** — lastPullAt, BT printer fields
4. **sms.ts** (new) — SMS composer helper
5. **thermal.ts** (new) — Bluetooth ESC/POS wrapper
6. **MilkCollectionScreen** — walk-in + SMS + thermal print integration
7. **UnionSaleScreen** (new)
8. **PaymentReportScreen** (new) + print.ts additions
9. **SettingsScreen** — BT printer pairing section
10. **HomeScreen tiles** + **App.tsx** nav + **ReportsScreen** links
11. **schema.sql** — union_sales table
12. **Install deps** — `expo-sms`, `react-native-thermal-printer-driver`
13. **Verify** — tsc + expo export

---

## Remaining After Milestone 3

These would be Milestone 4+:

| Feature | Notes |
|---------|-------|
| Item sales (shop) | `ItemSales`, `NewItem` — feed, supplies shop |
| Bonus report | Seasonal bonus per farmer |
| P&L report | Profit/loss: purchased vs sold |
| Member KYC expansion | Aadhaar, PAN, bank branch in form |
| Milk analyzer serial input | Hardware native module |
| RazorpayX payouts | Auto-pay farmers via bank transfer |
| Multi-user roles | Admin vs operator permissions |
| Bill reports | `BillDetailReport`, `BillSummaryReport` |
| Custom report designer | `PdfReportDesign` |
| Backup/restore | Full SQLite DB backup |
| SMS triggers (incoming) | Auto-balance SMS reply |

---

## Verification Plan

### Automated Tests
```bash
npx tsc --noEmit
npx expo export
```

### Manual Verification
- Two-way sync: sign in on two devices, create entries on each, sync, verify data appears on both
- SMS: save a collection → verify SMS app opens with correct number + message
- BT printer: pair a thermal printer in settings → save collection → receipt auto-prints
- Walk-in: leave member code empty → save → receipt prints, no SMS button
- Union sale: add sale → verify in reports
- Payment report: select farmer + range → verify PDF matches data
