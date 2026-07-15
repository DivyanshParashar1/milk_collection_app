-- ============================================================================
-- Milk App — Supabase schema (Postgres)
-- Multi-tenant dairy milk-collection backend. Replaces the original
-- vdcomputers.in server. Run this in Supabase Studio → SQL Editor.
-- ============================================================================

-- ---------- SOCIETIES (tenants) --------------------------------------------
create table if not exists societies (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,          -- society/dairy code
  name         text not null,
  address      text,
  milk_id      int  default 0,                -- which milk-type config
  activated    boolean default true,
  subscription_end_date timestamptz default (now() + interval '14 days'),
  is_active    boolean default true,
  created_at   timestamptz default now()
);

-- ---------- PROFILES (link Supabase auth users -> a society) ----------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  society_id  uuid references societies(id) on delete set null,
  full_name   text,
  role        text default 'operator',        -- operator | admin
  is_super_admin boolean default false,
  created_at  timestamptz default now()
);

-- Helper: society_id of the current user (used by every RLS policy)
create or replace function current_society_id()
returns uuid language sql stable as $$
  select society_id from profiles where id = auth.uid()
$$;

-- ---------- MEMBERS (farmers) — trimmed member_master -----------------------
create table if not exists members (
  id             uuid primary key default gen_random_uuid(),
  society_id     uuid not null references societies(id) on delete cascade,
  membercode     int  not null,               -- unique within society
  name           text not null,
  name_local     text,                         -- local-script name (for slips)
  mobile1        text,
  mobile2        text,
  address        text,
  animal_type    text default 'mix',           -- cow | buff | mix
  -- payout details
  upi_id         text,                          -- farmer's UPI VPA, e.g. 9876543210@ybl
  bank_name      text,
  bank_account   text,
  ifsc_code      text,
  aadhaar_no     text,
  fix_deduction  numeric default 0,            -- per-litre kapat %
  blacklisted    boolean default false,
  enter_date     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (society_id, membercode)
);

-- ---------- RATE CHARTS (fat -> rate) — fatrate_entry -----------------------
create table if not exists rate_charts (
  id           uuid primary key default gen_random_uuid(),
  society_id   uuid not null references societies(id) on delete cascade,
  name         text not null,                  -- e.g. "Cow morning"
  animal_type  text default 'mix',
  method       text default 'fat',             -- fat | fat_snf
  active       boolean default true,
  created_at   timestamptz default now()
);

create table if not exists rate_chart_entries (
  id            uuid primary key default gen_random_uuid(),
  chart_id      uuid not null references rate_charts(id) on delete cascade,
  fat           numeric not null,              -- fat % step
  snf           numeric,                        -- optional, for fat_snf method
  rate          numeric not null,              -- ₹ per litre/kg at this fat
  commission    numeric default 0,
  addition      numeric default 0
);
create index if not exists idx_rate_entries_chart on rate_chart_entries(chart_id, fat);

-- ---------- MILK COLLECTION (core) — milkcollection -------------------------
create table if not exists milk_collections (
  id            uuid primary key default gen_random_uuid(),
  society_id    uuid not null references societies(id) on delete cascade,
  membercode    int  not null,
  member_id     uuid references members(id) on delete set null,
  session       int  default 0,                -- 0 = morning (AM), 1 = evening (PM)
  collect_date  date not null default current_date,
  collect_time  timestamptz default now(),
  weight        numeric default 0,             -- litres / kg
  fat           numeric default 0,             -- fat %
  snf           numeric default 0,             -- SNF %
  clr           numeric default 0,             -- corrected lactometer reading
  rate          numeric default 0,             -- ₹/litre (from chart)
  price         numeric default 0,             -- weight * rate
  kg_fat        numeric default 0,             -- fat * weight / 100
  kg_snf        numeric default 0,             -- snf * weight / 100
  deduction     numeric default 0,             -- kapat amount
  pay_price     numeric default 0,             -- price - deduction
  animal_type   text default 'mix',
  operator_id   uuid references profiles(id),
  created_at    timestamptz default now()
);
create index if not exists idx_mc_society_date on milk_collections(society_id, collect_date, session);
create index if not exists idx_mc_member on milk_collections(society_id, membercode);

-- ---------- LEDGER (jama / udhar) — jama_udhar_entry ------------------------
create table if not exists ledger_entries (
  id           uuid primary key default gen_random_uuid(),
  society_id   uuid not null references societies(id) on delete cascade,
  membercode   int not null,
  amount       numeric not null,
  kind         text not null,                  -- 'jama' (credit) | 'udhar' (debit)
  note         text,
  entry_date   date default current_date,
  created_at   timestamptz default now()
);

-- ---------- SUBSCRIPTIONS (Razorpay) — society pays to use the app ----------
-- Razorpay is ONLY for the app subscription/license, never for farmer payouts.
create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  society_id          uuid not null references societies(id) on delete cascade,
  amount              numeric not null,         -- ₹ subscription fee
  currency            text default 'INR',
  purpose             text default 'subscription',
  plan                text,                      -- e.g. monthly | yearly
  razorpay_order_id   text,
  razorpay_payment_id text,
  status              text default 'created',    -- created | paid | failed
  note                text,
  created_at          timestamptz default now()
);

-- ---------- PAYOUTS (to farmers) — cash or UPI, NO gateway -------------------
create table if not exists payouts (
  id           uuid primary key default gen_random_uuid(),
  society_id   uuid not null references societies(id) on delete cascade,
  membercode   int not null,
  amount       numeric not null,               -- ₹ paid to farmer
  method       text not null,                  -- 'cash' | 'upi'
  upi_ref      text,                            -- optional UPI txn note/ref
  note         text,
  paid_at      timestamptz default now()
);
create index if not exists idx_payouts_society on payouts(society_id, membercode);

-- ============================================================================
-- ROW LEVEL SECURITY — each user only sees their own society's data
-- ============================================================================
alter table societies         enable row level security;
alter table profiles          enable row level security;
alter table members           enable row level security;
alter table rate_charts       enable row level security;
alter table rate_chart_entries enable row level security;
alter table milk_collections  enable row level security;
alter table ledger_entries    enable row level security;
alter table payments          enable row level security;
alter table payouts           enable row level security;

-- profiles: a user can read/update only their own profile row
create policy "own profile" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- societies: members of the society can read it
create policy "read own society" on societies
  for select using (id = current_society_id());

-- generic per-society policy for the tenant tables
create policy "society rw" on members
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());
create policy "society rw" on rate_charts
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());
create policy "society rw" on milk_collections
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());
create policy "society rw" on ledger_entries
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());
create policy "society rw" on payments
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());
create policy "society rw" on payouts
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

-- rate_chart_entries inherit access via their parent chart
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

-- ============================================================================
-- New-user trigger: auto-create a profile row when someone signs up.
-- (society_id is filled in later during onboarding.)
-- ============================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''          -- pin it, then fully-qualify tables below
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

-- ---------- LOCAL SALES (direct-to-consumer) --------------------------------
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

alter table local_sales enable row level security;
create policy "society rw" on local_sales
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());

-- ---------- UNION SALES (selling to milk federation) ------------------------
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

alter table union_sales enable row level security;
create policy "society rw" on union_sales
  for all using (society_id = current_society_id()) with check (society_id = current_society_id());
