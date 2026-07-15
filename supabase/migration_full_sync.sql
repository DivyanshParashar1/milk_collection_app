-- ============================================================================
-- FULL SCHEMA RECONCILIATION — run in Supabase Studio → SQL Editor.
-- Brings any existing database up to the schema the app expects
-- (schema.sql + milestone 4). Safe & idempotent: it only CREATEs what's
-- missing, ADDs missing columns, and re-asserts policies/triggers. It never
-- drops data or existing columns. Supersedes migration_v4.sql (and fixes its
-- local_sales bug — the app's local_sales uses `milk_type`, not session/paid/note).
--
-- Run the schema dump (introspect.sql) first and share it if you want me to add
-- targeted fixes for any *unexpected* drift (wrong column types, stray objects)
-- that an additive script like this one cannot auto-correct.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES — create if missing (full definitions match schema.sql)
-- ---------------------------------------------------------------------------
create table if not exists societies (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  name         text not null,
  address      text,
  milk_id      int  default 0,
  activated    boolean default true,
  subscription_end_date timestamptz default (now() + interval '14 days'),
  is_active    boolean default true,
  created_at   timestamptz default now()
);

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  society_id  uuid references societies(id) on delete set null,
  full_name   text,
  role        text default 'operator',
  is_super_admin boolean default false,
  created_at  timestamptz default now()
);

create table if not exists members (
  id             uuid primary key default gen_random_uuid(),
  society_id     uuid not null references societies(id) on delete cascade,
  membercode     int  not null,
  name           text not null,
  name_local     text,
  mobile1        text,
  mobile2        text,
  address        text,
  animal_type    text default 'mix',
  upi_id         text,
  bank_name      text,
  bank_account   text,
  ifsc_code      text,
  aadhaar_no     text,
  fix_deduction  numeric default 0,
  blacklisted    boolean default false,
  enter_date     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (society_id, membercode)
);

create table if not exists rate_charts (
  id           uuid primary key default gen_random_uuid(),
  society_id   uuid not null references societies(id) on delete cascade,
  name         text not null,
  animal_type  text default 'mix',
  method       text default 'fat',
  active       boolean default true,
  created_at   timestamptz default now()
);

create table if not exists rate_chart_entries (
  id            uuid primary key default gen_random_uuid(),
  chart_id      uuid not null references rate_charts(id) on delete cascade,
  fat           numeric not null,
  snf           numeric,
  rate          numeric not null,
  commission    numeric default 0,
  addition      numeric default 0
);
create index if not exists idx_rate_entries_chart on rate_chart_entries(chart_id, fat);

create table if not exists milk_collections (
  id            uuid primary key default gen_random_uuid(),
  society_id    uuid not null references societies(id) on delete cascade,
  membercode    int  not null,
  member_id     uuid references members(id) on delete set null,
  session       int  default 0,
  collect_date  date not null default current_date,
  collect_time  timestamptz default now(),
  weight        numeric default 0,
  fat           numeric default 0,
  snf           numeric default 0,
  clr           numeric default 0,
  rate          numeric default 0,
  price         numeric default 0,
  kg_fat        numeric default 0,
  kg_snf        numeric default 0,
  deduction     numeric default 0,
  pay_price     numeric default 0,
  animal_type   text default 'mix',
  operator_id   uuid references profiles(id),
  created_at    timestamptz default now()
);
create index if not exists idx_mc_society_date on milk_collections(society_id, collect_date, session);
create index if not exists idx_mc_member on milk_collections(society_id, membercode);

create table if not exists ledger_entries (
  id           uuid primary key default gen_random_uuid(),
  society_id   uuid not null references societies(id) on delete cascade,
  membercode   int not null,
  amount       numeric not null,
  kind         text not null,
  note         text,
  entry_date   date default current_date,
  created_at   timestamptz default now()
);

create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  society_id          uuid not null references societies(id) on delete cascade,
  amount              numeric not null,
  currency            text default 'INR',
  purpose             text default 'subscription',
  plan                text,
  razorpay_order_id   text,
  razorpay_payment_id text,
  status              text default 'created',
  note                text,
  created_at          timestamptz default now()
);

create table if not exists payouts (
  id           uuid primary key default gen_random_uuid(),
  society_id   uuid not null references societies(id) on delete cascade,
  membercode   int not null,
  amount       numeric not null,
  method       text not null,
  upi_ref      text,
  note         text,
  paid_at      timestamptz default now()
);
create index if not exists idx_payouts_society on payouts(society_id, membercode);

create table if not exists local_sales (
  id             uuid primary key default gen_random_uuid(),
  society_id     uuid not null references societies(id) on delete cascade,
  customer_name  text,
  quantity       numeric not null,
  rate           numeric not null,
  amount         numeric not null,
  milk_type      text default 'mix',
  sale_date      date default current_date,
  created_at     timestamptz default now()
);
create index if not exists idx_local_sales_society on local_sales(society_id, sale_date);

create table if not exists union_sales (
  id             uuid primary key default gen_random_uuid(),
  society_id     uuid not null references societies(id) on delete cascade,
  sale_date      date not null default current_date,
  session        smallint default 0,
  quantity       numeric not null,
  fat            numeric default 0,
  snf            numeric default 0,
  rate           numeric default 0,
  amount         numeric default 0,
  kg_fat         numeric default 0,
  kg_snf         numeric default 0,
  union_name     text,
  note           text,
  created_at     timestamptz default now()
);
create index if not exists idx_union_sales_society on union_sales(society_id, sale_date);

-- ---------------------------------------------------------------------------
-- 2. COLUMNS — add any that older databases may be missing
--    (CREATE TABLE above won't backfill columns onto tables that already exist)
-- ---------------------------------------------------------------------------
alter table societies add column if not exists milk_id int default 0;
alter table societies add column if not exists activated boolean default true;
alter table societies add column if not exists subscription_end_date timestamptz default (now() + interval '14 days');
alter table societies add column if not exists is_active boolean default true;

alter table profiles  add column if not exists society_id uuid references societies(id) on delete set null;
alter table profiles  add column if not exists role text default 'operator';
alter table profiles  add column if not exists is_super_admin boolean default false;

alter table members add column if not exists name_local    text;
alter table members add column if not exists mobile2       text;
alter table members add column if not exists address       text;
alter table members add column if not exists animal_type   text default 'mix';
alter table members add column if not exists upi_id        text;
alter table members add column if not exists bank_name     text;
alter table members add column if not exists bank_account  text;
alter table members add column if not exists ifsc_code     text;
alter table members add column if not exists aadhaar_no    text;
alter table members add column if not exists fix_deduction numeric default 0;
alter table members add column if not exists blacklisted   boolean default false;
alter table members add column if not exists updated_at    timestamptz default now();

alter table milk_collections add column if not exists member_id   uuid references members(id) on delete set null;
alter table milk_collections add column if not exists collect_time timestamptz default now();
alter table milk_collections add column if not exists clr         numeric default 0;
alter table milk_collections add column if not exists kg_fat      numeric default 0;
alter table milk_collections add column if not exists kg_snf      numeric default 0;
alter table milk_collections add column if not exists deduction   numeric default 0;
alter table milk_collections add column if not exists pay_price   numeric default 0;
alter table milk_collections add column if not exists animal_type text default 'mix';
alter table milk_collections add column if not exists operator_id uuid references profiles(id);

alter table ledger_entries add column if not exists note text;
alter table ledger_entries add column if not exists entry_date date default current_date;

alter table payouts add column if not exists upi_ref text;
alter table payouts add column if not exists note    text;

-- KEY FIX: the app writes/reads local_sales.milk_type. Ensure it exists even if
-- an earlier migration created local_sales without it.
alter table local_sales add column if not exists milk_type     text default 'mix';
alter table local_sales add column if not exists customer_name text;
alter table local_sales add column if not exists sale_date     date default current_date;

-- ---------------------------------------------------------------------------
-- 3. HELPER FUNCTION
-- ---------------------------------------------------------------------------
create or replace function current_society_id()
returns uuid language sql stable as $$
  select society_id from profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table societies          enable row level security;
alter table profiles           enable row level security;
alter table members            enable row level security;
alter table rate_charts        enable row level security;
alter table rate_chart_entries enable row level security;
alter table milk_collections   enable row level security;
alter table ledger_entries     enable row level security;
alter table payments           enable row level security;
alter table payouts            enable row level security;
alter table local_sales        enable row level security;
alter table union_sales        enable row level security;

-- ---------------------------------------------------------------------------
-- 5. POLICIES — drop-then-create so re-running never errors "already exists"
-- ---------------------------------------------------------------------------
drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "read own society" on societies;
create policy "read own society" on societies
  for select using (id = current_society_id());

-- Super admins (profiles.is_super_admin = true) can read/manage every society.
drop policy if exists "super admin societies" on societies;
create policy "super admin societies" on societies
  for all using (
    (select is_super_admin from profiles where id = auth.uid()) = true
  ) with check (
    (select is_super_admin from profiles where id = auth.uid()) = true
  );

drop policy if exists "society rw" on members;
create policy "society rw" on members
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

drop policy if exists "society rw" on rate_charts;
create policy "society rw" on rate_charts
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

drop policy if exists "society rw" on milk_collections;
create policy "society rw" on milk_collections
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

drop policy if exists "society rw" on ledger_entries;
create policy "society rw" on ledger_entries
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

drop policy if exists "society rw" on payments;
create policy "society rw" on payments
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

drop policy if exists "society rw" on payouts;
create policy "society rw" on payouts
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

drop policy if exists "society rw" on local_sales;
create policy "society rw" on local_sales
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

drop policy if exists "society rw" on union_sales;
create policy "society rw" on union_sales
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

drop policy if exists "society rw" on rate_chart_entries;
create policy "society rw" on rate_chart_entries
  for all using (
    exists (select 1 from rate_charts c
            where c.id = rate_chart_entries.chart_id
              and c.society_id = current_society_id())
  ) with check (
    exists (select 1 from rate_charts c
            where c.id = rate_chart_entries.chart_id
              and c.society_id = current_society_id())
  );

-- ---------------------------------------------------------------------------
-- 6. NEW-USER TRIGGER — auto-create a profile row on signup
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- 7. Grant super-admin to the admin login (mobile 8824753192).
--    No-op until that account exists — re-run this statement after creating it.
-- ---------------------------------------------------------------------------
update profiles set is_super_admin = true
where id in (select id from auth.users where email = '8824753192@milkapp.local');
