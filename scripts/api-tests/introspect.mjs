// Prints the live schema so the test suites can assert against what is actually
// deployed rather than what the migration files claim. This is how the payments
// (direction/membercode) and local_sales (NOT NULL sale_date) drift from
// schema.sql was found.
//
// Run: node scripts/api-tests/introspect.mjs
//
// For exact column types and NOT NULLs, the PostgREST OpenAPI spec is better
// than sampling rows (an empty table reveals nothing):
//   curl -s "$SUPABASE_URL/rest/v1/" -H "apikey: $KEY" | jq '.definitions.union_sales'
import { admin } from './lib/clients.mjs';

// No arbitrary-SQL RPC exists, so probe each table through PostgREST.
const TABLES = [
  'societies', 'profiles', 'members', 'rate_charts', 'rate_chart_entries',
  'milk_collections', 'ledger_entries', 'payments', 'payouts',
  'local_sales', 'union_sales', 'app_config',
];

console.log('table                | exists | columns');
console.log('---------------------|--------|--------------------------------------');
for (const t of TABLES) {
  const { data, error } = await admin.from(t).select('*').limit(1);
  if (error) {
    console.log(`${t.padEnd(20)} | NO     | ${error.message}`);
    continue;
  }
  const cols = data?.length ? Object.keys(data[0]).join(', ') : '(empty table — no column sample)';
  console.log(`${t.padEnd(20)} | yes    | ${cols}`);
}

// Row counts give a sense of what is real production data vs leftovers.
console.log('\nrow counts:');
for (const t of TABLES) {
  const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true });
  if (!error) console.log(`  ${t.padEnd(20)} ${count}`);
}

console.log('\nsocieties (id, code, name, is_active, subscription_end_date):');
const { data: socs } = await admin
  .from('societies')
  .select('id, code, name, is_active, subscription_end_date')
  .order('created_at', { ascending: false })
  .limit(20);
for (const s of socs ?? []) {
  console.log(`  ${s.code?.padEnd(14)} ${s.is_active ? 'active  ' : 'INACTIVE'} ends=${s.subscription_end_date} ${s.name}`);
}
