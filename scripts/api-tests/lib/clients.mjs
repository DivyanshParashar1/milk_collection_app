// ============================================================================
// Supabase clients for the API test suites.
//
// `anon`    — what the real app uses. RLS applies. Assertions about what a user
//             CAN'T do must go through this client, never the admin one.
// `admin`   — service_role. Bypasses RLS. Fixtures/teardown only: creating test
//             societies, linking profiles, forcing subscription expiry.
// `freshAnon()` — an isolated client with its own session, so signing in as
//             user B doesn't clobber user A's session in the same process.
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../../../.env.test');

function loadEnv() {
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    console.error(`\nMissing ${envPath}\nCreate it with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.\n`);
    process.exit(1);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();

export const SUPABASE_URL = env.SUPABASE_URL;
export const ANON_KEY = env.SUPABASE_ANON_KEY;
export const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of Object.entries({ SUPABASE_URL, ANON_KEY, SERVICE_KEY })) {
  if (!v) {
    console.error(`\n.env.test is missing ${k}\n`);
    process.exit(1);
  }
}

// Sessions must not persist to disk between runs, and must not leak across
// clients — every client below is memory-only and independent.
const noPersist = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

export const anon = createClient(SUPABASE_URL, ANON_KEY, noPersist);
export const admin = createClient(SUPABASE_URL, SERVICE_KEY, noPersist);

export function freshAnon() {
  return createClient(SUPABASE_URL, ANON_KEY, noPersist);
}

/** A client authenticated as `email`, isolated from every other client. */
export async function signedInAs(email, password) {
  const c = freshAnon();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`fixture sign-in failed for ${email}: ${error.message}`);
  return { client: c, session: data.session, userId: data.user.id };
}
