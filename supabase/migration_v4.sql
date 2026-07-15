-- Milestone 4 Migration (Run this in Supabase SQL Editor)
-- Safe to re-run: every statement is idempotent (guarded with IF [NOT] EXISTS
-- or DROP POLICY IF EXISTS ... CREATE POLICY).

-- 1. Add subscription and status to societies
ALTER TABLE societies ADD COLUMN IF NOT EXISTS subscription_end_date timestamptz DEFAULT (now() + interval '14 days');
ALTER TABLE societies ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- 2. Add super admin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin boolean DEFAULT false;

-- 3. Create Local Sales table (if missing)
CREATE TABLE IF NOT EXISTS local_sales (
  id             uuid primary key default gen_random_uuid(),
  society_id     uuid not null references societies(id) on delete cascade,
  sale_date      date not null default current_date,
  session        smallint default 0,
  customer_name  text,
  quantity       numeric not null,
  rate           numeric not null,
  amount         numeric not null,
  paid           boolean default false,
  note           text,
  created_at     timestamptz default now()
);
CREATE INDEX IF NOT EXISTS idx_local_sales_society ON local_sales(society_id, sale_date);

ALTER TABLE local_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "society rw" ON local_sales;
CREATE POLICY "society rw" ON local_sales
  FOR ALL USING (society_id = current_society_id()) WITH CHECK (society_id = current_society_id());

-- 4. Create Union Sales table (if missing)
CREATE TABLE IF NOT EXISTS union_sales (
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
CREATE INDEX IF NOT EXISTS idx_union_sales_society ON union_sales(society_id, sale_date);

ALTER TABLE union_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "society rw" ON union_sales;
CREATE POLICY "society rw" ON union_sales
  FOR ALL USING (society_id = current_society_id()) WITH CHECK (society_id = current_society_id());

-- 5. Super Admin access to all societies
-- NOTE: schema.sql already enables RLS on societies and creates the
-- "read own society" SELECT policy, so we only add the super-admin override here.
ALTER TABLE societies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super admin societies" ON societies;
CREATE POLICY "super admin societies" ON societies
  FOR ALL USING (
    (SELECT is_super_admin FROM profiles WHERE id = auth.uid()) = true
  ) WITH CHECK (
    (SELECT is_super_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- 6. Grant the super-admin flag to the admin account.
-- The app routes the account that signs in as mobile 8824753192
-- (email 8824753192@milkapp.local) to the Super Admin panel; that same
-- account needs is_super_admin=true here for the RLS policy above to let it
-- read/update every society. No-op until the account exists, so if you create
-- the admin login later, just re-run this one statement.
UPDATE profiles SET is_super_admin = true
WHERE id IN (SELECT id FROM auth.users WHERE email = '8824753192@milkapp.local');
