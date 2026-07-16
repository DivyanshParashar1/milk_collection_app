// ============================================================================
// Tiny test harness — no dependencies, no global test runner.
//
// Every test states what it EXPECTS and the harness records what actually
// happened, so a run is a readable log rather than a pass/fail bit. Postgres
// error codes are asserted rather than message text: messages get reworded
// between Supabase releases, codes don't.
// ============================================================================
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = resolve(here, '../logs');

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', grey: '\x1b[90m',
};

const results = [];
let currentSuite = 'ungrouped';

export function suite(name) {
  currentSuite = name;
  console.log(`\n${c.bold}${c.cyan}▌ ${name}${c.reset}`);
}

/**
 * Run one test. `fn` returns a value; assertions throw.
 * A thrown AssertionError = fail. Any other throw = error (bug in the test or
 * an unreachable server) and is reported separately, because they mean
 * different things when you read the log.
 */
export async function test(name, fn) {
  const started = Date.now();
  const entry = { suite: currentSuite, name, status: 'pass', ms: 0, detail: null };
  try {
    const detail = await fn();
    entry.detail = detail ?? null;
  } catch (e) {
    entry.status = e?.isAssertion ? 'fail' : 'error';
    entry.detail = e?.message ?? String(e);
    entry.stack = e?.isAssertion ? undefined : e?.stack;
  }
  entry.ms = Date.now() - started;
  results.push(entry);

  const icon = entry.status === 'pass' ? `${c.green}✓` : entry.status === 'fail' ? `${c.red}✗` : `${c.yellow}!`;
  const detail = entry.status === 'pass'
    ? (entry.detail ? `${c.grey} — ${short(entry.detail)}` : '')
    : `\n    ${c.red}${entry.detail}`;
  console.log(`  ${icon} ${c.reset}${name}${detail}${c.reset} ${c.grey}${entry.ms}ms${c.reset}`);
  return entry;
}

function short(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 100 ? s.slice(0, 100) + '…' : s;
}

// ---------------------------------------------------------------- assertions
class AssertionError extends Error {
  constructor(msg) { super(msg); this.isAssertion = true; }
}
const fail = (msg) => { throw new AssertionError(msg); };

export function ok(cond, msg) {
  if (!cond) fail(msg || 'expected truthy');
}

export function eq(actual, expected, msg) {
  if (actual !== expected) fail(`${msg || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Assert a supabase-js result carries a Postgres/PostgREST error with `code`. */
export function expectPgError({ data, error }, code, label = '') {
  if (!error) fail(`${label} expected error ${code}, but the call SUCCEEDED (data=${short(data)}). This is a real hole.`);
  if (code && error.code !== code) {
    fail(`${label} expected code ${code}, got ${error.code} (${error.message})`);
  }
  return `${error.code}: ${error.message}`;
}

/** Assert the call failed somehow, without pinning the exact code. */
export function expectAnyError({ data, error }, label = '') {
  if (!error) fail(`${label} expected an error, but the call SUCCEEDED (data=${short(data)})`);
  return `${error.code ?? '—'}: ${error.message}`;
}

export function expectOk({ data, error }, label = '') {
  if (error) fail(`${label} expected success, got ${error.code}: ${error.message}`);
  return data;
}

/**
 * RLS on a SELECT does not error — it filters. "I can't see it" is therefore
 * an empty result, and asserting an error here would be wrong.
 */
export function expectRlsHidden({ data, error }, label = '') {
  if (error) fail(`${label} expected rows to be filtered out, got error ${error.code}: ${error.message}`);
  if (data?.length) fail(`${label} LEAK: RLS returned ${data.length} row(s) that should be invisible`);
  return 'filtered to 0 rows';
}

// ------------------------------------------------------------------ reporting
export function report() {
  const pass = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail');
  const errored = results.filter((r) => r.status === 'error');

  console.log(`\n${c.bold}────────────────────────────────────────${c.reset}`);
  console.log(`${c.green}${pass} passed${c.reset}  ${failed.length ? c.red : c.grey}${failed.length} failed${c.reset}  ${errored.length ? c.yellow : c.grey}${errored.length} errored${c.reset}  ${c.grey}of ${results.length}${c.reset}`);

  if (failed.length) {
    console.log(`\n${c.red}${c.bold}Failures:${c.reset}`);
    for (const f of failed) console.log(`  ${c.red}✗${c.reset} ${f.suite} › ${f.name}\n    ${c.grey}${f.detail}${c.reset}`);
  }
  if (errored.length) {
    console.log(`\n${c.yellow}${c.bold}Errored (test bug or unreachable server):${c.reset}`);
    for (const e of errored) console.log(`  ${c.yellow}!${c.reset} ${e.suite} › ${e.name}\n    ${c.grey}${e.detail}${c.reset}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const json = resolve(LOG_DIR, `run-${stamp}.json`);
  const md = resolve(LOG_DIR, `run-${stamp}.md`);
  writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), pass, fail: failed.length, error: errored.length, results }, null, 2));
  writeFileSync(md, markdown(pass, failed, errored));
  console.log(`\n${c.grey}logs → ${json.replace(process.cwd() + '/', '')}\n       ${md.replace(process.cwd() + '/', '')}${c.reset}\n`);

  return failed.length + errored.length;
}

function markdown(pass, failed, errored) {
  const lines = [
    `# API test run`,
    ``,
    `- **When:** ${new Date().toISOString()}`,
    `- **Passed:** ${pass} / ${results.length}`,
    `- **Failed:** ${failed.length}`,
    `- **Errored:** ${errored.length}`,
    ``,
  ];
  const suites = [...new Set(results.map((r) => r.suite))];
  for (const s of suites) {
    lines.push(`## ${s}`, ``, `| | Test | Result |`, `|---|---|---|`);
    for (const r of results.filter((x) => x.suite === s)) {
      const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '!';
      const detail = String(r.detail ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${icon} | ${r.name} | ${detail.slice(0, 160)} |`);
    }
    lines.push(``);
  }
  return lines.join('\n');
}
