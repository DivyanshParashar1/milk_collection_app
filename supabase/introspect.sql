-- ============================================================================
-- FULL SCHEMA DUMP — run this whole block in Supabase Studio → SQL Editor.
-- It returns ONE row / ONE cell (`schema_dump`) of pretty JSON describing every
-- public table (columns, constraints, indexes, RLS state, policies) plus all
-- functions and triggers. Copy that cell's value and paste it back to me.
-- Read-only: it changes nothing.
-- ============================================================================
with cols as (
  select table_name,
         jsonb_agg(jsonb_build_object(
           'column',   column_name,
           'type',     data_type,
           'nullable', is_nullable,
           'default',  column_default
         ) order by ordinal_position) as columns
  from information_schema.columns
  where table_schema = 'public'
  group by table_name
),
cons as (
  select c.relname as table_name,
         jsonb_agg(jsonb_build_object(
           'name', con.conname,
           'type', con.contype,          -- p=pk u=unique f=fk c=check
           'def',  pg_get_constraintdef(con.oid)
         ) order by con.conname) as constraints
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  where con.connamespace = 'public'::regnamespace
  group by c.relname
),
idx as (
  select tablename as table_name,
         jsonb_agg(jsonb_build_object('name', indexname, 'def', indexdef) order by indexname) as indexes
  from pg_indexes
  where schemaname = 'public'
  group by tablename
),
rls as (
  select relname as table_name, relrowsecurity as rls_enabled
  from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
),
pol as (
  select tablename as table_name,
         jsonb_agg(jsonb_build_object(
           'name',  policyname,
           'cmd',   cmd,
           'roles', roles,
           'using', qual,
           'check', with_check
         ) order by policyname) as policies
  from pg_policies
  where schemaname = 'public'
  group by tablename
)
select jsonb_pretty(jsonb_build_object(
  'tables', (
    select jsonb_agg(jsonb_build_object(
      'table',       r.table_name,
      'rls_enabled', r.rls_enabled,
      'columns',     coalesce(c.columns,    '[]'::jsonb),
      'constraints', coalesce(cons.constraints, '[]'::jsonb),
      'indexes',     coalesce(idx.indexes,  '[]'::jsonb),
      'policies',    coalesce(pol.policies, '[]'::jsonb)
    ) order by r.table_name)
    from rls r
    left join cols c   on c.table_name    = r.table_name
    left join cons     on cons.table_name = r.table_name
    left join idx      on idx.table_name  = r.table_name
    left join pol      on pol.table_name  = r.table_name
  ),
  'functions', (
    select jsonb_agg(jsonb_build_object(
      'name',             p.proname,
      'args',             pg_get_function_arguments(p.oid),
      'returns',          pg_get_function_result(p.oid),
      'security_definer', p.prosecdef
    ) order by p.proname)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
  ),
  'triggers', (
    select jsonb_agg(jsonb_build_object(
      'name',  tgname,
      'table', tgrelid::regclass::text,
      'def',   pg_get_triggerdef(oid)
    ) order by tgname)
    from pg_trigger
    where not tgisinternal
      and tgfoid in (select oid from pg_proc where pronamespace = 'public'::regnamespace)
  )
)) as schema_dump;
