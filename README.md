# MilkApp — React Native dairy collection app

A clean-room rebuild of a dairy milk-collection app in **Expo / React Native + TypeScript**,
backed by your own **Supabase** (free Postgres + auth) and **Razorpay** payments.
Offline-first: entries save locally (SQLite) and sync up when online.

## Milestone 1 (done) — core loop
Login → add member → milk collection (weight + fat → auto rate/price) → offline save → sync → payment.

## Stack
- **App:** Expo SDK 57, React Native 0.86, TypeScript, React Navigation
- **Local DB:** expo-sqlite (offline-first, dirty-row sync)
- **Backend/DB:** Supabase (Postgres + Auth + RLS + Edge Functions)
- **Payments:** Razorpay (order created server-side in an Edge Function)

## Project layout
```
src/
  lib/
    supabase.ts   Supabase client (reads .env)
    db.ts         local SQLite: members, milk_collections, rate chart, sync helpers
    calc.ts       rate/price/kg-fat/SNF engine (verified against known cases)
    sync.ts       pushes unsynced rows to Supabase
  context/AuthContext.tsx   session state
  screens/        Login, Home, MemberForm, MilkCollection, Payment
supabase/
  schema.sql                 run this in Supabase SQL editor
  functions/razorpay-order/  Edge Function that creates Razorpay orders
```

## Setup

1. **Supabase**
   - Create a free project at supabase.com.
   - SQL Editor → paste & run `supabase/schema.sql`.
   - Project Settings → API → copy the URL and anon key.
   - Insert one society + link your user (after signing up in the app):
     ```sql
     insert into societies (code, name) values ('S001', 'My Dairy');
     update profiles set society_id = (select id from societies where code='S001')
       where id = (select id from auth.users limit 1);
     ```

2. **Env**
   ```
   cp .env.example .env    # then fill in EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY
   ```

3. **Razorpay** (test mode to start)
   - Get test keys from the Razorpay dashboard.
   - `supabase functions deploy razorpay-order`
   - `supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx`

4. **Run**
   ```
   npx expo start                 # Expo Go: everything except the Razorpay popup
   npx expo run:android           # dev-client: full native incl. Razorpay checkout
   ```
   > The Razorpay checkout popup and (later) USB/Bluetooth printer need a
   > **dev-client build**, not Expo Go — that's why we chose Expo + dev-client.

## Verified
- `npx tsc --noEmit` — clean
- `npx expo export` — bundles (917 modules), no errors
- `src/lib/calc.ts` — checked against known cases (rate floor-match, price, kapat, kg-fat, SNF-from-CLR)

## Roadmap (from APP_ANALYSIS.md — ~50 screens total)
- Rate-chart editor screen, member list/search, sessions lock
- Reports: daily, datewise, payment, bonus, jama/udhar, P&L
- Local/union/item sales, deductions (kapat)
- Thermal/USB/Bluetooth slip printing (native module), milk analyzer serial input
- Razorpay **payouts to farmers** (RazorpayX) using the bank/IFSC fields
- Two-way sync (server → device pull), multi-user roles
```
