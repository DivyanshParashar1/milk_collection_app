-- ============================================================================
-- Migration 002 — farmer UPI id + payouts table + subscription framing
-- Run this in Supabase → SQL Editor on the existing project. Non-destructive.
-- ============================================================================

-- 1) Farmer's UPI id (VPA), used to pre-fill the UPI app at payout time.
alter table members add column if not exists upi_id text;

-- 2) Repurpose `payments` for the app subscription (Razorpay). Additive only.
alter table payments add column if not exists purpose text default 'subscription';
alter table payments add column if not exists plan text;

-- 3) Farmer payouts (cash / UPI) — no payment gateway involved.
create table if not exists payouts (
  id           uuid primary key default gen_random_uuid(),
  society_id   uuid not null references societies(id) on delete cascade,
  membercode   int not null,
  amount       numeric not null,
  method       text not null,          -- 'cash' | 'upi'
  upi_ref      text,
  note         text,
  paid_at      timestamptz default now()
);
create index if not exists idx_payouts_society on payouts(society_id, membercode);

alter table payouts enable row level security;

drop policy if exists "society rw" on payouts;
create policy "society rw" on payouts
  for all using (society_id = current_society_id())
  with check (society_id = current_society_id());
