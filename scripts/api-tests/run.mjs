#!/usr/bin/env node
// ============================================================================
// API test runner.
//
//   node scripts/api-tests/run.mjs              # everything
//   node scripts/api-tests/run.mjs auth rls     # named suites only
//   node scripts/api-tests/run.mjs --keep       # leave fixtures up to inspect
//   node scripts/api-tests/run.mjs --sweep      # delete leftover TEST_ data, exit
//
// Runs against the LIVE project. Everything it creates is tagged TEST_<runid>
// and removed in a finally block, so a crash mid-run still cleans up.
// ============================================================================
import { setup, teardown, sweepOldTestData, RUN_ID } from './lib/fixtures.mjs';
import { report } from './lib/harness.mjs';
import { SUPABASE_URL } from './lib/clients.mjs';

import authSuite from './suites/auth.mjs';
import rlsSuite from './suites/rls.mjs';
import constraintsSuite from './suites/constraints.mjs';
import syncSuite from './suites/sync.mjs';
import subscriptionSuite from './suites/subscription.mjs';
import edgeSuite from './suites/edge.mjs';

const SUITES = {
  auth: authSuite,
  rls: rlsSuite,
  constraints: constraintsSuite,
  sync: syncSuite,
  subscription: subscriptionSuite,
  edge: edgeSuite,
};

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const sweep = args.includes('--sweep');
const wanted = args.filter((a) => !a.startsWith('--'));

const c = { bold: '\x1b[1m', grey: '\x1b[90m', yellow: '\x1b[33m', reset: '\x1b[0m' };

if (sweep) {
  console.log(`${c.yellow}Sweeping leftover TEST_ fixtures…${c.reset}`);
  const swept = await sweepOldTestData();
  console.log(`removed ${swept.societies} societies, ${swept.users} users`);
  process.exit(0);
}

const chosen = wanted.length ? wanted : Object.keys(SUITES);
for (const name of chosen) {
  if (!SUITES[name]) {
    console.error(`Unknown suite "${name}". Available: ${Object.keys(SUITES).join(', ')}`);
    process.exit(1);
  }
}

console.log(`${c.bold}Milk app · API tests${c.reset}`);
console.log(`${c.grey}target : ${SUPABASE_URL}`);
console.log(`run id : ${RUN_ID}`);
console.log(`suites : ${chosen.join(', ')}${c.reset}`);
console.log(`${c.yellow}Live project — fixtures are tagged TEST_${RUN_ID} and deleted afterwards.${c.reset}`);

let fx;
let exitCode = 1;
try {
  console.log(`\n${c.grey}Setting up fixtures…${c.reset}`);
  fx = await setup();
  console.log(`${c.grey}  society A ${fx.societyA.code} (active)`);
  console.log(`  society B ${fx.societyB.code} (active, the other tenant)`);
  console.log(`  society C ${fx.societyC.code} (expired + inactive)${c.reset}`);

  for (const name of chosen) {
    await SUITES[name](fx);
  }
  exitCode = report() === 0 ? 0 : 1;
} catch (e) {
  console.error(`\n\x1b[31mRun aborted: ${e.message}\x1b[0m`);
  console.error(e.stack);
  try { report(); } catch {}
} finally {
  if (keep) {
    console.log(`${c.yellow}--keep: fixtures left in place. Remove them with --sweep.${c.reset}`);
  } else {
    console.log(`${c.grey}Tearing down fixtures…${c.reset}`);
    const errors = await teardown();
    if (errors.length) {
      console.log(`${c.yellow}Teardown left things behind:${c.reset}`);
      for (const e of errors) console.log(`  ${e}`);
      console.log(`${c.yellow}Run --sweep to clean up.${c.reset}`);
    } else {
      console.log(`${c.grey}  clean.${c.reset}`);
    }
  }
}

process.exit(exitCode);
