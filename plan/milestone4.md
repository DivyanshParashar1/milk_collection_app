# Milestone 4 — Login, Admin & Inventory

## 1. Mobile Number Login
- Modify `LoginScreen.tsx` to accept a 10-digit mobile number instead of email.
- Fake the email for Supabase Auth: `const fakeEmail = ${mobileNumber}@milkapp.local;`
- This allows us to use `signInWithPassword` and `signUp` without configuring an SMS provider (no OTP required).

## 2. Super Admin Panel
- **Schema**: Add `subscription_end_date` (timestamptz) and `is_active` (boolean, default true) to `societies`. Add `super_admin` boolean to `profiles`.
- **UI**: Create a hidden `SuperAdminScreen`. Access it by entering a specific admin mobile number (e.g. `9999999999`) or via a hidden long-press on the login logo if logged in as admin.
- **Controls**: List all societies, view collection counts, extend subscription dates, and toggle `is_active`.
- **App Block**: If `subscription_end_date` is past or `is_active` is false, the app forces the user to a "Subscription Expired" screen.

## 3. Local Sale & Inventory
- **Inventory View**: Create an "Inventory" card on the `HomeScreen` showing:
  `Opening Balance + Milk Collected - Local Sales - Union Sales = Remaining Milk`.
- **Add Stock**: Allow users to add outside milk (Opening Balance) by creating a system member (Member Code `9999` - "Self / Opening Stock"). Milk entered for this member adds to inventory without needing a new DB table for purchases.

## 4. SQL Migration Script
- Provide a full SQL script to be pasted into Supabase SQL Editor.
- Script contents:
  1. Add `subscription_end_date` to `societies`.
  2. Add `is_super_admin` to `profiles`.
  3. Create `local_sales` table and RLS (if missing).
  4. Create `union_sales` table and RLS.
  5. Policy for Super Admins to view/edit all societies.
