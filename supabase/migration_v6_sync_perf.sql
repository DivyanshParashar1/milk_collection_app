-- =============================================================================
-- Migration v6 — Sync performance (Run in Supabase Studio → SQL Editor)
-- Safe to re-run: every statement is idempotent.
--
-- WHY SYNC IS SLOW — it is not the free tier's CPU, it is two things:
--
--   1. RLS re-ran the society lookup FOR EVERY ROW. Every policy said
--      `society_id = current_society_id()`, and that function body is
--      `select society_id from profiles where id = auth.uid()`. Postgres may
--      only hoist a stable function out of a per-row filter when it is written
--      as a scalar sub-select, so a 500-row sync did ~500 extra reads of
--      `profiles` — plus 500 RLS checks on `profiles` itself. Wrapping it as
--      `(select current_society_id())` turns it into an InitPlan: evaluated
--      ONCE per statement, then compared as a constant.
--
--   2. Pull queries had no index to sit on. pullAll() filters
--      `society_id = ? and created_at > lastPull`, but the only indexes were on
--      (society_id, collect_date) etc. — so each pull seq-scanned the table and
--      ran the per-row RLS check above on every row it threw away.
--
-- Together these make sync cost grow with TOTAL rows in the table rather than
-- with the number of rows actually being synced. That is the real reason it
-- feels slow, and it is why it would keep feeling slow on a paid tier too.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Re-create every policy with the society lookup as a scalar sub-select.
--    Identical semantics — a row is still only visible to its own society.
-- -----------------------------------------------------------------------------

drop policy if exists "read own society" on societies;
create policy "read own society" on societies
  for select using (id = (select current_society_id()));

drop policy if exists "society rw" on members;
create policy "society rw" on members
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on rate_charts;
create policy "society rw" on rate_charts
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on milk_collections;
create policy "society rw" on milk_collections
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on ledger_entries;
create policy "society rw" on ledger_entries
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on payments;
create policy "society rw" on payments
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on payouts;
create policy "society rw" on payouts
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on local_sales;
create policy "society rw" on local_sales
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

drop policy if exists "society rw" on union_sales;
create policy "society rw" on union_sales
  for all using (society_id = (select current_society_id()))
  with check (society_id = (select current_society_id()));

-- rate_chart_entries reaches its society through its parent chart.
drop policy if exists "society rw" on rate_chart_entries;
create policy "society rw" on rate_chart_entries
  for all using (
    exists (select 1 from rate_charts c
            where c.id = rate_chart_entries.chart_id
              and c.society_id = (select current_society_id()))
  ) with check (
    exists (select 1 from rate_charts c
            where c.id = rate_chart_entries.chart_id
              and c.society_id = (select current_society_id()))
  );

-- -----------------------------------------------------------------------------
-- 2. Indexes matching what pullAll() filters on:
--    `society_id = ? and updated_at > lastPull order by updated_at`.
--    With these, a pull that finds nothing new costs an index probe instead of
--    a full table scan — which is the common case, every foreground, forever.
--
--    NOTE: every table is pulled by `updated_at`, not `created_at`. v5 added
--    updated_at everywhere precisely for this, and `payouts` never had a
--    created_at at all — its timestamp is `paid_at` (a business date that can be
--    backdated, so it is the wrong thing to page a sync on anyway). Pulling on
--    updated_at is also the only version that ever sees a server-side EDIT.
-- -----------------------------------------------------------------------------

-- Belt and braces: v5 should have added these, but make v6 stand on its own so
-- the index below can never reference a column that isn't there.
alter table milk_collections add column if not exists updated_at timestamptz default now();
alter table payouts          add column if not exists updated_at timestamptz default now();
alter table ledger_entries   add column if not exists updated_at timestamptz default now();
alter table local_sales      add column if not exists updated_at timestamptz default now();
alter table union_sales      add column if not exists updated_at timestamptz default now();

create index if not exists idx_members_society_updated on members          (society_id, updated_at);
create index if not exists idx_mc_society_updated      on milk_collections (society_id, updated_at);
create index if not exists idx_payouts_society_updated on payouts          (society_id, updated_at);
create index if not exists idx_ledger_society_updated  on ledger_entries   (society_id, updated_at);
create index if not exists idx_lsales_society_updated  on local_sales      (society_id, updated_at);
create index if not exists idx_usales_society_updated  on union_sales      (society_id, updated_at);

-- profiles is read by current_society_id() on every statement; it is the PK, but
-- make sure the planner has fresh stats for these new paths.
analyze profiles;
analyze members;
analyze milk_collections;
analyze payouts;
analyze ledger_entries;
analyze local_sales;
analyze union_sales;

-- Done! ✓
