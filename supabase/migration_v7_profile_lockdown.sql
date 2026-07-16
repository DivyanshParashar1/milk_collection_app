-- =============================================================================
-- Migration v7 — CRITICAL: stop clients writing their own profile.
-- Run in Supabase Studio → SQL Editor. Safe to re-run.
--
-- THE HOLE
-- --------
-- migration_full_sync.sql shipped:
--
--     create policy "own profile" on profiles
--       for all using (id = auth.uid()) with check (id = auth.uid());
--
-- `for all` includes UPDATE, and the check pins only WHICH ROW you may write,
-- not WHICH COLUMNS. profiles holds the two columns that decide everything:
--
--   society_id     → current_society_id() → every "society rw" policy
--   is_super_admin → the "super admin societies"/"super admin app_config" policies
--
-- So any signed-up dairy could run:
--
--   update profiles set society_id = '<victim>' where id = auth.uid();
--      → read AND write that dairy's farmers, bank accounts, UPI ids, collections
--
--   update profiles set is_super_admin = true where id = auth.uid();
--      → read/update EVERY society (extend own subscription, disable rivals)
--      → rewrite app_config.upi_vpa and redirect every subscription payment
--
-- Both were confirmed against the live project with a normal signup account.
--
-- THE FIX
-- -------
-- Nothing in the app ever writes profiles — src/lib/sync.ts and src/lib/upiPay.ts
-- only SELECT society_id. So the client needs SELECT and nothing more.
--
-- Two independent layers, because either alone is enough to be bypassed by a
-- future policy edit:
--   1. RLS: a SELECT-only policy. No INSERT/UPDATE/DELETE policy exists, so RLS
--      denies those outright.
--   2. Column GRANTs: even if someone later re-adds a permissive UPDATE policy,
--      society_id and is_super_admin are not grantable to the client.
--
-- handle_new_user() is SECURITY DEFINER, so signup still creates profiles.
-- service_role is untouched, so SuperAdminScreen and the test fixtures still work.
-- =============================================================================

-- 1. Replace the blanket FOR ALL policy with read-only ------------------------
drop policy if exists "own profile" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;

create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

-- A user may rename themselves, and nothing else. The column GRANT below is what
-- actually confines this to full_name; the policy just scopes it to their row.
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- 2. Column-level privileges --------------------------------------------------
-- RLS decides which ROWS; GRANTs decide which COLUMNS. society_id and
-- is_super_admin are deliberately absent from the grant list.
revoke insert, update, delete on public.profiles from authenticated, anon;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- 3. societies — deliberately NOT locked down the same way ---------------------
-- Tempting to `revoke update on societies from authenticated` too. Don't:
-- GRANTs are per-ROLE, and the super admin is also just `authenticated` (RLS is
-- what separates them, via "super admin societies"). Revoking would break
-- SuperAdminScreen's approve() / addDays() / toggleActive().
--
-- societies is already safe without it: its only non-super-admin policy is
-- "read own society" (SELECT), so a normal user's UPDATE matches no policy and
-- RLS denies it. Verified — `subscription` suite, "a normal user cannot extend
-- their own subscription" passes today.

-- =============================================================================
-- VERIFY — run after applying. Every one of these must come back denied.
-- =============================================================================
-- As a normal signed-in user (not service_role):
--
--   update profiles set is_super_admin = true where id = auth.uid();
--     → ERROR: permission denied for table profiles
--   update profiles set society_id = '<any uuid>' where id = auth.uid();
--     → ERROR: permission denied for table profiles
--   update profiles set full_name = 'New name' where id = auth.uid();
--     → OK (the one permitted write)
--
-- Or just re-run the suite, which asserts exactly this:
--   node scripts/api-tests/run.mjs rls
-- =============================================================================
