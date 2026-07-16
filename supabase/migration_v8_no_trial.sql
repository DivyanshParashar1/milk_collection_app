-- =============================================================================
-- Migration v8 — no trial. A new dairy is locked from day 1.
-- Run in Supabase Studio → SQL Editor. Safe to re-run.
--
-- THE HOLE
-- --------
-- migration_full_sync.sql shipped:
--
--     subscription_end_date timestamptz default (now() + interval '14 days')
--
-- handle_new_user() never names that column, so every signup silently took the
-- default and got 14 days of full write access for free. The client agreed:
-- computeLocked() read `!!s.subscriptionEnd && <past>`, so an absent date read
-- as "not expired" → unlocked.
--
-- THE FIX
-- -------
-- A society is born with NO subscription (null end date), not an expired one:
-- null is the truthful value for "never subscribed", and it survives clock skew
-- in a way `now()` does not. The client half of this lands in src/lib/subscription.ts
-- — computeLocked() now locks on a missing date. Both halves are required:
-- without this migration the first pull writes a trial date and unlocks the
-- device anyway; without the client change the pre-first-pull window is open.
--
-- Renewal is unaffected. SuperAdminScreen's approve() and addDays() already read
-- a null end date as "start from now" (`soc?.subscription_end_date ? ... : new Date()`),
-- so the first payment lands the same as it always did.
--
-- EXISTING SOCIETIES ARE NOT TOUCHED. This changes who gets a subscription from
-- here on; it does not retroactively lock dairies that are mid-trial today. See
-- the commented-out statement at the bottom if you want that too.
-- =============================================================================

-- 1. Drop the trial default -------------------------------------------------
alter table public.societies alter column subscription_end_date drop default;

-- 2. Say it in the trigger too ----------------------------------------------
-- The column default is now harmless, but naming the column here means a future
-- edit that re-adds a default cannot quietly hand out trials again.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_society_id uuid;
  v_society_name text;
  v_society_code text;
begin
  -- Derive society name from signup metadata; fall back to full_name or email prefix
  v_society_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'society_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    split_part(new.email, '@', 1)
  );

  -- Generate a unique society code (8-char random hex)
  v_society_code := lower(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- Create a brand-new society for this account. subscription_end_date is null
  -- on purpose: no trial, so the dairy is locked until a payment is approved.
  insert into public.societies (code, name, activated, is_active, subscription_end_date)
  values (v_society_code, v_society_name, true, true, null)
  returning id into v_society_id;

  -- Create the profile linked to the new society
  insert into public.profiles (id, full_name, society_id)
  values (new.id, new.raw_user_meta_data->>'full_name', v_society_id)
  on conflict (id) do update set society_id = v_society_id;

  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =============================================================================
-- VERIFY — run after applying.
-- =============================================================================
--   select column_default from information_schema.columns
--    where table_name = 'societies' and column_name = 'subscription_end_date';
--     → null  (was: (now() + '14 days'::interval))
--
-- Then sign up a throwaway account and check its society:
--   select code, subscription_end_date, is_active from societies
--    order by created_at desc limit 1;
--     → subscription_end_date null, is_active true
--   In the app that account can open every screen and save nothing.
-- =============================================================================

-- OPTIONAL — retroactively end trials that are still running.
-- This locks real dairies that signed up expecting 14 days, so it is left
-- commented out deliberately. Uncomment only once you have decided to do that.
--
--   update public.societies set subscription_end_date = null
--    where id not in (select society_id from public.payments where status = 'paid')
--      and subscription_end_date > now();
