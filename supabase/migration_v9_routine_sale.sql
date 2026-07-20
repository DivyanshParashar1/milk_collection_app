-- =============================================================================
-- Migration v9 — Routine sale + union sale on fat  (app 1.1.0)
-- Run in Supabase Studio → SQL Editor. Safe to re-run.
--
-- BACKWARD COMPATIBILITY IS NOT OPTIONAL HERE.
-- v1.0.0 is installed on phones we cannot recall or force-update. Those devices
-- keep pushing to this exact database, and they know nothing about anything
-- below. So every statement is either a NEW table (they never touch it) or a
-- NEW column WITH A DEFAULT (their inserts omit it and still succeed).
--
-- Never in this file, and never in any later one:
--   * dropping or renaming a column an old client still sends
--   * adding NOT NULL without a DEFAULT
--   * tightening a constraint on existing rows
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Union sale priced on fat
--
-- 1.0.0 computed amount = quantity × rate and had no idea what the rate meant.
-- rate_basis defaults to 'litre' precisely because that is what those rows are:
-- back-filling them to 'fat' would silently reprice every historical sale.
-- New clients send 'fat' explicitly.
-- -----------------------------------------------------------------------------
alter table union_sales add column if not exists rate_basis text default 'litre';
alter table union_sales add column if not exists fat_rate   numeric default 0;

-- -----------------------------------------------------------------------------
-- 2. Routine customers — people the dairy delivers to daily.
--
-- Deliberately NOT members: members sell milk to the society, these people buy
-- it. Sharing the table would put customers into payout runs and collection
-- reports.
-- -----------------------------------------------------------------------------
create table if not exists routine_customers (
  id         uuid primary key default gen_random_uuid(),
  society_id uuid not null references societies(id) on delete cascade,
  client_id  text,
  name       text not null,
  mobile     text,
  address    text,
  milk_type  text default 'mix',
  rate       numeric default 0,      -- 0 = use the society's local sale rate
  am_active  boolean default true,
  am_qty     numeric default 0,
  pm_active  boolean default false,
  pm_qty     numeric default 0,
  active     boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (society_id, client_id)
);

-- One row per customer per date per session. The unique constraint is what lets
-- a re-saved checklist update the day instead of billing it twice.
create table if not exists routine_deliveries (
  id            uuid primary key default gen_random_uuid(),
  society_id    uuid not null references societies(id) on delete cascade,
  client_id     text,
  customer_id   uuid not null references routine_customers(id) on delete cascade,
  delivery_date date not null,
  session       smallint not null default 0,   -- 0 = AM, 1 = PM
  quantity      numeric not null default 0,
  rate          numeric not null default 0,
  amount        numeric not null default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (society_id, client_id),
  unique (customer_id, delivery_date, session)
);

create table if not exists routine_payments (
  id          uuid primary key default gen_random_uuid(),
  society_id  uuid not null references societies(id) on delete cascade,
  client_id   text,
  customer_id uuid not null references routine_customers(id) on delete cascade,
  amount      numeric not null,
  method      text not null default 'cash',
  note        text,
  paid_on     date default current_date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (society_id, client_id)
);

-- -----------------------------------------------------------------------------
-- 3. RLS — same one-society-one-tenant rule as every other table, written with
--    the society lookup as a scalar sub-select so it stays an InitPlan (v6).
-- -----------------------------------------------------------------------------
alter table routine_customers  enable row level security;
alter table routine_deliveries enable row level security;
alter table routine_payments   enable row level security;

drop policy if exists "society rw" on routine_customers;
create policy "society rw" on routine_customers
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on routine_deliveries;
create policy "society rw" on routine_deliveries
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on routine_payments;
create policy "society rw" on routine_payments
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

-- -----------------------------------------------------------------------------
-- 4. updated_at triggers — pullAll() pages on updated_at, so a row that is
--    edited server-side has to move or the edit never reaches the phone.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_routine_customers_updated  on routine_customers;
drop trigger if exists trg_routine_deliveries_updated on routine_deliveries;
drop trigger if exists trg_routine_payments_updated   on routine_payments;

create trigger trg_routine_customers_updated  before update on routine_customers  for each row execute function set_updated_at();
create trigger trg_routine_deliveries_updated before update on routine_deliveries for each row execute function set_updated_at();
create trigger trg_routine_payments_updated   before update on routine_payments   for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Indexes matching what the app actually queries:
--    pull  → (society_id, updated_at)
--    statement / balance → (customer_id, date)
-- -----------------------------------------------------------------------------
create index if not exists idx_rcust_society_updated on routine_customers  (society_id, updated_at);
create index if not exists idx_rdel_society_updated  on routine_deliveries (society_id, updated_at);
create index if not exists idx_rpay_society_updated  on routine_payments   (society_id, updated_at);
create index if not exists idx_rdel_customer_date    on routine_deliveries (customer_id, delivery_date);
create index if not exists idx_rpay_customer_date    on routine_payments   (customer_id, paid_on);

analyze routine_customers;
analyze routine_deliveries;
analyze routine_payments;
analyze union_sales;

-- Done! ✓
