// ============================================================================
// Offline-first local store (expo-sqlite).
//
// The app writes every entry here FIRST (works with no internet), then sync.ts
// pushes rows where synced = 0 up to Supabase — mirroring the original app's
// `synflags`/`vd_flgs` dirty-row mechanism.
// ============================================================================
import * as SQLite from 'expo-sqlite';
import { assertUnlocked } from './subscription';
import { APP_VERSION } from './version';

/** Generate a UUID v4 (works in Expo SDK 57+ which ships crypto.randomUUID). */
function newUUID(): string {
  // crypto.randomUUID is available globally via react-native-url-polyfill
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: Math.random-based UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('milkapp.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS members (
      local_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id    TEXT,
      client_id    TEXT,
      membercode   INTEGER NOT NULL,
      name         TEXT NOT NULL,
      name_local   TEXT,
      mobile1      TEXT,
      animal_type  TEXT DEFAULT 'mix',
      upi_id       TEXT,
      bank_account TEXT,
      ifsc_code    TEXT,
      fix_deduction REAL DEFAULT 0,
      synced       INTEGER DEFAULT 0,
      updated_at   TEXT DEFAULT (datetime('now')),
      UNIQUE(membercode)
    );

    CREATE TABLE IF NOT EXISTS payouts (
      local_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id  TEXT,
      client_id  TEXT,
      membercode INTEGER NOT NULL,
      amount     REAL NOT NULL,
      method     TEXT NOT NULL,          -- 'cash' | 'upi'
      upi_ref    TEXT,
      note       TEXT,
      synced     INTEGER DEFAULT 0,
      paid_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS milk_collections (
      local_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id    TEXT,
      client_id    TEXT,
      membercode   INTEGER NOT NULL,
      session      INTEGER DEFAULT 0,
      collect_date TEXT NOT NULL,
      weight       REAL DEFAULT 0,
      fat          REAL DEFAULT 0,
      snf          REAL DEFAULT 0,
      clr          REAL DEFAULT 0,
      rate         REAL DEFAULT 0,
      price        REAL DEFAULT 0,
      kg_fat       REAL DEFAULT 0,
      kg_snf       REAL DEFAULT 0,
      deduction    REAL DEFAULT 0,
      pay_price    REAL DEFAULT 0,
      animal_type  TEXT DEFAULT 'mix',
      synced       INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rate_chart_entries (
      local_id INTEGER PRIMARY KEY AUTOINCREMENT,
      fat  REAL NOT NULL,
      snf  REAL,
      rate REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      local_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id    TEXT,
      client_id    TEXT,
      membercode   INTEGER NOT NULL,
      amount       REAL NOT NULL,
      kind         TEXT NOT NULL,          -- 'jama' (credit) | 'udhar' (debit)
      note         TEXT,
      entry_date   TEXT DEFAULT (date('now')),
      synced       INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS local_sales (
      local_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id      TEXT,
      client_id      TEXT,
      customer_name  TEXT,
      quantity       REAL NOT NULL,
      rate           REAL NOT NULL,
      amount         REAL NOT NULL,
      milk_type      TEXT DEFAULT 'mix',    -- cow | buff | mix
      sale_date      TEXT DEFAULT (date('now')),
      synced         INTEGER DEFAULT 0,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS local_sale_rates (
      milk_type      TEXT PRIMARY KEY,      -- cow | buff | mix
      rate_per_litre REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS kapat_items (
      local_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id TEXT,
      name      TEXT NOT NULL,
      type      TEXT NOT NULL DEFAULT 'percent', -- 'percent' | 'fixed'
      value     REAL NOT NULL DEFAULT 0,
      active    INTEGER DEFAULT 1,
      synced    INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS member_kapat (
      membercode INTEGER NOT NULL,
      kapat_id   INTEGER NOT NULL,
      active     INTEGER DEFAULT 1,
      PRIMARY KEY (membercode, kapat_id)
    );

    CREATE TABLE IF NOT EXISTS session_locks (
      collect_date TEXT NOT NULL,
      session      INTEGER NOT NULL,        -- 0 = AM, 1 = PM
      locked       INTEGER DEFAULT 0,
      UNIQUE(collect_date, session)
    );

    CREATE TABLE IF NOT EXISTS union_sales (
      local_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id    TEXT,
      client_id    TEXT,
      sale_date    TEXT NOT NULL,
      session      INTEGER DEFAULT 0,
      quantity     REAL NOT NULL,
      fat          REAL DEFAULT 0,
      snf          REAL DEFAULT 0,
      rate         REAL DEFAULT 0,
      amount       REAL DEFAULT 0,
      kg_fat       REAL DEFAULT 0,
      kg_snf       REAL DEFAULT 0,
      union_name   TEXT,
      note         TEXT,
      synced       INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    -- Remembered union defaults. Single row (id = 1): the operator sells to the
    -- same union at the same fat rate every day and must not retype it.
    CREATE TABLE IF NOT EXISTS union_sale_rates (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      fat_rate   REAL NOT NULL DEFAULT 0,   -- ₹ per fat point per litre
      rate_basis TEXT NOT NULL DEFAULT 'fat', -- 'fat' | 'litre'
      litre_rate REAL NOT NULL DEFAULT 0,   -- only used when basis = 'litre'
      union_name TEXT
    );

    -- ---------- Routine (home delivery) sale ----------
    -- Known customers who get milk delivered every day. Distinct from members:
    -- these people BUY milk, farmers SELL it, and mixing them would put
    -- customers into payouts and collection reports.
    CREATE TABLE IF NOT EXISTS routine_customers (
      local_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id  TEXT,
      client_id  TEXT,
      name       TEXT NOT NULL,
      mobile     TEXT,
      address    TEXT,
      milk_type  TEXT DEFAULT 'mix',        -- cow | buff | mix
      rate       REAL DEFAULT 0,            -- 0 = fall back to local_sale_rates
      am_active  INTEGER DEFAULT 1,         -- delivered in the morning?
      am_qty     REAL DEFAULT 0,            -- standing morning quantity (L)
      pm_active  INTEGER DEFAULT 0,
      pm_qty     REAL DEFAULT 0,
      active     INTEGER DEFAULT 1,         -- 0 = stopped, keep history
      synced     INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- One row per customer per date per session, written when the checklist is
    -- saved. UNIQUE lets a re-save of the same checklist update instead of
    -- duplicating the day.
    CREATE TABLE IF NOT EXISTS routine_deliveries (
      local_id      INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id     TEXT,
      client_id     TEXT,
      customer_id   INTEGER NOT NULL,       -- routine_customers.local_id
      delivery_date TEXT NOT NULL,
      session       INTEGER NOT NULL DEFAULT 0,  -- 0 = AM, 1 = PM
      quantity      REAL NOT NULL DEFAULT 0,
      rate          REAL NOT NULL DEFAULT 0,
      amount        REAL NOT NULL DEFAULT 0,
      synced        INTEGER DEFAULT 0,
      updated_at    TEXT DEFAULT (datetime('now')),
      created_at    TEXT DEFAULT (datetime('now')),
      UNIQUE(customer_id, delivery_date, session)
    );

    -- Money received from a routine customer against their running account.
    CREATE TABLE IF NOT EXISTS routine_payments (
      local_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id   TEXT,
      client_id   TEXT,
      customer_id INTEGER NOT NULL,
      amount      REAL NOT NULL,
      method      TEXT NOT NULL DEFAULT 'cash',  -- 'cash' | 'upi'
      note        TEXT,
      paid_on     TEXT DEFAULT (date('now')),
      synced      INTEGER DEFAULT 0,
      updated_at  TEXT DEFAULT (datetime('now')),
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rd_customer_date ON routine_deliveries (customer_id, delivery_date);
    CREATE INDEX IF NOT EXISTS idx_rd_date_session  ON routine_deliveries (delivery_date, session);
    CREATE INDEX IF NOT EXISTS idx_rp_customer      ON routine_payments   (customer_id, paid_on);

    -- Local schema bookkeeping (see runLocalMigrations below).
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await runLocalMigrations(_db);

  // Seed "Walk-in" member (code 0) so walk-in collections have a name in reports
  // Seed "Opening Stock" (code 9999) so added milk can be tracked as collection
  try {
    await _db.execAsync(
      `INSERT OR IGNORE INTO members (membercode, name, synced) VALUES (0, 'Walk-in', 1);
       INSERT OR IGNORE INTO members (membercode, name, synced) VALUES (9999, 'Self/Opening Stock', 1);`
    );
  } catch {}

  return _db;
}

// ============================================================================
// Local schema migrations
//
// CREATE TABLE IF NOT EXISTS above handles fresh installs. This handles the
// other case, which is now the common one: a phone that already has v1.0.0's
// database and is being upgraded in place. Its tables exist, so CREATE does
// nothing, and any column added later has to be ALTERed in.
//
// Each step is additive and idempotent, and the highest applied step number is
// stored in app_meta so a launch that has nothing to do costs one SELECT
// instead of a dozen ALTERs that all throw.
//
// Adding a step: append to the array and bump SCHEMA_VERSION in version.ts.
// Never edit or remove an existing step — devices in the field have already
// recorded it as applied and will never run it again.
// ============================================================================
const MIGRATIONS: { version: number; sql: string[] }[] = [
  {
    // v1 — everything that shipped as blind try/catch ALTERs in 1.0.0.
    version: 1,
    sql: [
      `ALTER TABLE members ADD COLUMN upi_id TEXT`,
      `ALTER TABLE members ADD COLUMN client_id TEXT`,
      `ALTER TABLE payouts ADD COLUMN client_id TEXT`,
      `ALTER TABLE milk_collections ADD COLUMN client_id TEXT`,
      `ALTER TABLE ledger_entries ADD COLUMN client_id TEXT`,
      `ALTER TABLE local_sales ADD COLUMN client_id TEXT`,
      `ALTER TABLE union_sales ADD COLUMN client_id TEXT`,
      `ALTER TABLE rate_chart_entries ADD COLUMN fat_type TEXT DEFAULT 'mix'`,
    ],
  },
  {
    // v2 (app 1.1.0) — union sale priced on fat.
    //
    // Existing rows default to 'litre' because that is exactly what 1.0.0
    // wrote: amount = quantity × rate. Back-filling them to 'fat' would
    // silently reinterpret every historical union sale.
    version: 2,
    sql: [
      `ALTER TABLE union_sales ADD COLUMN rate_basis TEXT DEFAULT 'litre'`,
      `ALTER TABLE union_sales ADD COLUMN fat_rate REAL DEFAULT 0`,
    ],
  },
];

async function runLocalMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  // app_meta is created in the same execAsync as the tables, so it is always
  // there by the time we get here — but a database from 1.0.0 has no row yet,
  // and its ALTERs have effectively already been applied by the old
  // try/catch code. Running them again is harmless: each one throws
  // "duplicate column name" and is swallowed below.
  let applied = 0;
  try {
    const row: any = await db.getFirstAsync(`SELECT value FROM app_meta WHERE key = 'schema_version'`);
    applied = parseInt(row?.value ?? '0', 10) || 0;
  } catch {}

  for (const step of MIGRATIONS) {
    if (step.version <= applied) continue;
    for (const stmt of step.sql) {
      // "duplicate column name" is expected on any device that already got
      // this column from 1.0.0's untracked ALTERs. Anything else is a real
      // problem, but throwing here would leave the app unable to open its own
      // database — so we swallow and let the failing query surface it instead.
      try { await db.execAsync(stmt); } catch {}
    }
    applied = step.version;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)`,
    [String(applied)]
  );
  await db.runAsync(
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('app_version', ?)`,
    [APP_VERSION]
  );
}

/** The app version that last opened this database — useful in bug reports. */
export async function getStoredAppVersion(): Promise<string | null> {
  const db = await getDb();
  const row: any = await db.getFirstAsync(`SELECT value FROM app_meta WHERE key = 'app_version'`);
  return row?.value ?? null;
}

/**
 * Run `fn` inside a single SQLite transaction.
 *
 * Sync writes hundreds of rows at once; without this each statement commits
 * separately and pays its own fsync, which is what made syncing feel like a
 * slow network rather than slow disk.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const db = await getDb();
  let result!: T;
  await db.withTransactionAsync(async () => {
    result = await fn();
  });
  return result;
}

/** Return today's date as YYYY-MM-DD in IST (UTC+5:30). */
export function todayIST(): string {
  const now = new Date();
  // IST = UTC + 5h 30m
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

// ---------- Members ----------
export type LocalMember = {
  membercode: number;
  name: string;
  name_local?: string;
  mobile1?: string;
  animal_type?: string;
  upi_id?: string;
  bank_account?: string;
  ifsc_code?: string;
  fix_deduction?: number;
};

export async function insertMember(m: LocalMember) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO members
      (client_id, membercode, name, name_local, mobile1, animal_type, upi_id, bank_account, ifsc_code, fix_deduction, synced, updated_at)
     VALUES (COALESCE((SELECT client_id FROM members WHERE membercode=?), ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
    [
      m.membercode, newUUID(), // COALESCE: keep existing client_id on replace
      m.membercode,
      m.name,
      m.name_local ?? null,
      m.mobile1 ?? null,
      m.animal_type ?? 'mix',
      m.upi_id ?? null,
      m.bank_account ?? null,
      m.ifsc_code ?? null,
      m.fix_deduction ?? 0,
    ]
  );
}

export async function listMembers(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM members ORDER BY membercode`);
}

export async function getMemberByCode(code: number): Promise<any | null> {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM members WHERE membercode = ?`, [code]);
}

export async function updateMember(m: LocalMember) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `UPDATE members SET name=?, name_local=?, mobile1=?, animal_type=?, upi_id=?,
       bank_account=?, ifsc_code=?, fix_deduction=?, synced=0, updated_at=datetime('now')
     WHERE membercode=?`,
    [
      m.name,
      m.name_local ?? null,
      m.mobile1 ?? null,
      m.animal_type ?? 'mix',
      m.upi_id ?? null,
      m.bank_account ?? null,
      m.ifsc_code ?? null,
      m.fix_deduction ?? 0,
      m.membercode,
    ]
  );
}

/** Delete a member and all their local data (collections, payouts, ledger). */
export async function deleteMember(membercode: number) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(`DELETE FROM milk_collections WHERE membercode=?`, [membercode]);
  await db.runAsync(`DELETE FROM payouts WHERE membercode=?`, [membercode]);
  await db.runAsync(`DELETE FROM ledger_entries WHERE membercode=?`, [membercode]);
  await db.runAsync(`DELETE FROM members WHERE membercode=?`, [membercode]);
}

/** All members with their current balance (milk earned + jama − payouts − udhar). */
export async function membersWithBalances(): Promise<any[]> {
  const db = await getDb();
  const members: any[] = await db.getAllAsync(`SELECT * FROM members ORDER BY membercode`);
  const earned: any[] = await db.getAllAsync(
    `SELECT membercode, COALESCE(SUM(pay_price),0) v FROM milk_collections GROUP BY membercode`
  );
  const paid: any[] = await db.getAllAsync(
    `SELECT membercode, COALESCE(SUM(amount),0) v FROM payouts GROUP BY membercode`
  );
  const jamaMap: any[] = await db.getAllAsync(
    `SELECT membercode, COALESCE(SUM(CASE WHEN kind='jama' THEN amount ELSE 0 END),0) jama,
            COALESCE(SUM(CASE WHEN kind='udhar' THEN amount ELSE 0 END),0) udhar
     FROM ledger_entries GROUP BY membercode`
  );
  const em = new Map(earned.map((r) => [r.membercode, r.v]));
  const pm = new Map(paid.map((r) => [r.membercode, r.v]));
  const lm = new Map(jamaMap.map((r) => [r.membercode, { jama: r.jama, udhar: r.udhar }]));
  return members.map((m) => {
    const ledger = lm.get(m.membercode) ?? { jama: 0, udhar: 0 };
    return {
      ...m,
      balance: (em.get(m.membercode) ?? 0) + ledger.jama - (pm.get(m.membercode) ?? 0) - ledger.udhar,
    };
  });
}

export async function memberCollections(membercode: number, limit = 20): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM milk_collections WHERE membercode = ? ORDER BY local_id DESC LIMIT ?`,
    [membercode, limit]
  );
}

export async function memberPayouts(membercode: number, limit = 20): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM payouts WHERE membercode = ? ORDER BY local_id DESC LIMIT ?`,
    [membercode, limit]
  );
}

// ---------- Milk collections ----------
export type LocalCollection = {
  membercode: number;
  session: number;
  collect_date: string;
  weight: number;
  fat: number;
  snf: number;
  clr: number;
  rate: number;
  price: number;
  kg_fat: number;
  kg_snf: number;
  deduction: number;
  pay_price: number;
  animal_type?: string;
};

export async function insertCollection(c: LocalCollection) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO milk_collections
      (client_id, membercode, session, collect_date, weight, fat, snf, clr, rate, price, kg_fat, kg_snf, deduction, pay_price, animal_type, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      newUUID(),
      c.membercode, c.session, c.collect_date, c.weight, c.fat, c.snf, c.clr,
      c.rate, c.price, c.kg_fat, c.kg_snf, c.deduction, c.pay_price,
      c.animal_type ?? 'mix',
    ]
  );
}

export async function recentCollections(limit = 30): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM milk_collections ORDER BY local_id DESC LIMIT ?`,
    [limit]
  );
}

export async function collectionHistory(limit = 100): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT mc.*, m.name FROM milk_collections mc
     LEFT JOIN members m ON m.membercode = mc.membercode
     ORDER BY mc.local_id DESC LIMIT ?`,
    [limit]
  );
}

export async function getCollection(localId: number): Promise<any | null> {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM milk_collections WHERE local_id = ?`, [localId]);
}

export type CollectionValues = {
  weight: number; fat: number; snf: number; rate: number; price: number;
  kg_fat: number; kg_snf: number; deduction: number; pay_price: number;
};

export async function updateCollectionLocal(localId: number, c: CollectionValues) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `UPDATE milk_collections SET weight=?, fat=?, snf=?, rate=?, price=?,
       kg_fat=?, kg_snf=?, deduction=?, pay_price=? WHERE local_id=?`,
    [c.weight, c.fat, c.snf, c.rate, c.price, c.kg_fat, c.kg_snf, c.deduction, c.pay_price, localId]
  );
}

export async function deleteCollectionLocal(localId: number) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(`DELETE FROM milk_collections WHERE local_id = ?`, [localId]);
}

/** Today's totals for the dashboard. */
export async function todayTotals(): Promise<{ litres: number; amount: number; count: number }> {
  const db = await getDb();
  const today = todayIST();
  const row: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(weight),0) litres, COALESCE(SUM(price),0) amount, COUNT(*) count
     FROM milk_collections WHERE collect_date = ?`,
    [today]
  );
  return { litres: row?.litres ?? 0, amount: row?.amount ?? 0, count: row?.count ?? 0 };
}

/** Current Inventory (All-time sum) */
export async function inventoryTotals(): Promise<{ collected: number; unionSold: number; localSold: number; routineSold: number; remaining: number }> {
  const db = await getDb();
  const col: any = await db.getFirstAsync(`SELECT COALESCE(SUM(weight),0) val FROM milk_collections`);
  const union: any = await db.getFirstAsync(`SELECT COALESCE(SUM(quantity),0) val FROM union_sales`);
  const local: any = await db.getFirstAsync(`SELECT COALESCE(SUM(quantity),0) val FROM local_sales`);
  // Routine deliveries leave the tank exactly like a walk-in sale does, so
  // they have to come off stock or remaining silently overstates itself by a
  // few litres every single day.
  const routine: any = await db.getFirstAsync(`SELECT COALESCE(SUM(quantity),0) val FROM routine_deliveries`);
  const collected = col?.val ?? 0;
  const unionSold = union?.val ?? 0;
  const localSold = local?.val ?? 0;
  const routineSold = routine?.val ?? 0;
  return {
    collected,
    unionSold,
    localSold,
    routineSold,
    remaining: collected - unionSold - localSold - routineSold,
  };
}

// ---------- Reports (date-range aggregates) ----------
// Dates are 'YYYY-MM-DD' strings, matching how collect_date is stored.

export type CollectionSummary = {
  litres: number; amount: number; count: number; avgFat: number;
  amLitres: number; pmLitres: number;
};

export async function collectionSummary(from: string, to: string): Promise<CollectionSummary> {
  const db = await getDb();
  const r: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(weight),0) litres,
            COALESCE(SUM(price),0) amount,
            COUNT(*) count,
            COALESCE(AVG(fat),0) avgFat,
            COALESCE(SUM(CASE WHEN session=0 THEN weight ELSE 0 END),0) amLitres,
            COALESCE(SUM(CASE WHEN session=1 THEN weight ELSE 0 END),0) pmLitres
     FROM milk_collections WHERE collect_date BETWEEN ? AND ?`,
    [from, to]
  );
  return {
    litres: r?.litres ?? 0, amount: r?.amount ?? 0, count: r?.count ?? 0,
    avgFat: r?.avgFat ?? 0, amLitres: r?.amLitres ?? 0, pmLitres: r?.pmLitres ?? 0,
  };
}

export async function collectionByFarmer(from: string, to: string): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT mc.membercode,
            m.name,
            COALESCE(SUM(mc.weight),0) litres,
            COALESCE(SUM(mc.price),0) amount,
            COUNT(*) count
     FROM milk_collections mc
     LEFT JOIN members m ON m.membercode = mc.membercode
     WHERE mc.collect_date BETWEEN ? AND ?
     GROUP BY mc.membercode
     ORDER BY amount DESC`,
    [from, to]
  );
}

export async function payoutSummary(from: string, to: string): Promise<{ cash: number; upi: number; total: number; count: number }> {
  const db = await getDb();
  const r: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END),0) cash,
            COALESCE(SUM(CASE WHEN method='upi'  THEN amount ELSE 0 END),0) upi,
            COALESCE(SUM(amount),0) total,
            COUNT(*) count
     FROM payouts WHERE date(paid_at) BETWEEN ? AND ?`,
    [from, to]
  );
  return { cash: r?.cash ?? 0, upi: r?.upi ?? 0, total: r?.total ?? 0, count: r?.count ?? 0 };
}

// ---------- Rate chart (local cache) ----------
// Each animal type (cow/buff/mix) has its own rate chart stored with a type prefix.
export async function setRateChart(
  entries: { fat: number; snf?: number | null; rate: number }[],
  animalType: 'cow' | 'buff' | 'mix' = 'mix'
) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(`DELETE FROM rate_chart_entries WHERE fat_type = ? OR fat_type IS NULL`, [animalType]);
  for (const e of entries) {
    await db.runAsync(
      `INSERT INTO rate_chart_entries (fat, snf, rate, fat_type) VALUES (?, ?, ?, ?)`,
      [e.fat, e.snf ?? null, e.rate, animalType]
    );
  }
}

export async function getRateChart(
  animalType: 'cow' | 'buff' | 'mix' = 'mix'
): Promise<{ fat: number; snf?: number | null; rate: number }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT fat, snf, rate FROM rate_chart_entries WHERE fat_type = ? OR (fat_type IS NULL AND ? = 'mix') ORDER BY fat`,
    [animalType, animalType]
  );
  // If no specific chart exists for cow/buff, fall back to mix
  if (rows.length === 0 && animalType !== 'mix') {
    return db.getAllAsync(
      `SELECT fat, snf, rate FROM rate_chart_entries WHERE fat_type = 'mix' OR fat_type IS NULL ORDER BY fat`
    ) as Promise<any[]>;
  }
  return rows as any[];
}

// ---------- Payouts (cash / UPI to farmer) ----------
export type LocalPayout = {
  membercode: number;
  amount: number;
  method: 'cash' | 'upi';
  upi_ref?: string;
  note?: string;
};

export async function insertPayout(p: LocalPayout) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO payouts (client_id, membercode, amount, method, upi_ref, note, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [newUUID(), p.membercode, p.amount, p.method, p.upi_ref ?? null, p.note ?? null]
  );
}

/**
 * Net balance = (milk earnings + jama) − (payouts + udhar).
 * Positive = society owes farmer. Negative = farmer owes society.
 */
export async function farmerBalance(membercode: number): Promise<number> {
  const db = await getDb();
  const earned: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(pay_price),0) v FROM milk_collections WHERE membercode = ?`,
    [membercode]
  );
  const paid: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(amount),0) v FROM payouts WHERE membercode = ?`,
    [membercode]
  );
  const ledger: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(CASE WHEN kind='jama' THEN amount ELSE 0 END),0) jama,
            COALESCE(SUM(CASE WHEN kind='udhar' THEN amount ELSE 0 END),0) udhar
     FROM ledger_entries WHERE membercode = ?`,
    [membercode]
  );
  return (earned?.v ?? 0) + (ledger?.jama ?? 0) - (paid?.v ?? 0) - (ledger?.udhar ?? 0);
}

// ---------- Sync helpers ----------
export async function unsyncedMembers(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM members WHERE synced = 0`);
}
export async function unsyncedCollections(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM milk_collections WHERE synced = 0`);
}
export async function unsyncedPayouts(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM payouts WHERE synced = 0`);
}
export async function markMemberSynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE members SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}
export async function markCollectionSynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE milk_collections SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}
export async function markPayoutSynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE payouts SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}
export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const a: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM members WHERE synced = 0`);
  const b: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM milk_collections WHERE synced = 0`);
  const c: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM payouts WHERE synced = 0`);
  const d: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM ledger_entries WHERE synced = 0`);
  const e: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM local_sales WHERE synced = 0`);
  const f: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM union_sales WHERE synced = 0`);
  const g: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM routine_customers WHERE synced = 0`);
  const h: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM routine_deliveries WHERE synced = 0`);
  const i: any = await db.getFirstAsync(`SELECT COUNT(*) c FROM routine_payments WHERE synced = 0`);
  return (a?.c ?? 0) + (b?.c ?? 0) + (c?.c ?? 0) + (d?.c ?? 0) + (e?.c ?? 0) + (f?.c ?? 0)
       + (g?.c ?? 0) + (h?.c ?? 0) + (i?.c ?? 0);
}

// ---------- Ledger (Jama / Udhar) ----------
export type LocalLedgerEntry = {
  membercode: number;
  amount: number;
  kind: 'jama' | 'udhar';
  note?: string;
  entry_date?: string;
};

export async function insertLedgerEntry(e: LocalLedgerEntry) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO ledger_entries (client_id, membercode, amount, kind, note, entry_date, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [newUUID(), e.membercode, e.amount, e.kind, e.note ?? null, e.entry_date ?? new Date().toISOString().slice(0, 10)]
  );
}

export async function recentLedgerEntries(limit = 30): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT le.*, m.name FROM ledger_entries le
     LEFT JOIN members m ON m.membercode = le.membercode
     ORDER BY le.local_id DESC LIMIT ?`,
    [limit]
  );
}

export async function memberLedger(membercode: number, limit = 50): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM ledger_entries WHERE membercode = ? ORDER BY local_id DESC LIMIT ?`,
    [membercode, limit]
  );
}

export async function ledgerBalance(membercode: number): Promise<{ jama: number; udhar: number; net: number }> {
  const db = await getDb();
  const r: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(CASE WHEN kind='jama'  THEN amount ELSE 0 END),0) jama,
            COALESCE(SUM(CASE WHEN kind='udhar' THEN amount ELSE 0 END),0) udhar
     FROM ledger_entries WHERE membercode = ?`,
    [membercode]
  );
  const jama = r?.jama ?? 0;
  const udhar = r?.udhar ?? 0;
  return { jama, udhar, net: jama - udhar };
}

export async function unsyncedLedgerEntries(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM ledger_entries WHERE synced = 0`);
}

export async function markLedgerSynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE ledger_entries SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}

// ---------- Member Passbook (unified view) ----------
export type PassbookEntry = {
  date: string;
  type: 'collection' | 'payout' | 'jama' | 'udhar';
  description: string;
  credit: number;
  debit: number;
};

export async function memberPassbook(membercode: number): Promise<PassbookEntry[]> {
  const db = await getDb();
  // Union of all 3 record types, sorted by date
  const rows: any[] = await db.getAllAsync(
    `SELECT collect_date as date, 'collection' as type,
            weight || 'L · ' || fat || '% fat' as description,
            pay_price as credit, 0 as debit
     FROM milk_collections WHERE membercode = ?
     UNION ALL
     SELECT date(paid_at) as date, 'payout' as type,
            method || COALESCE(' · ' || note, '') as description,
            0 as credit, amount as debit
     FROM payouts WHERE membercode = ?
     UNION ALL
     SELECT entry_date as date, kind as type,
            COALESCE(note, kind) as description,
            CASE WHEN kind='jama' THEN amount ELSE 0 END as credit,
            CASE WHEN kind='udhar' THEN amount ELSE 0 END as debit
     FROM ledger_entries WHERE membercode = ?
     ORDER BY date DESC, credit DESC`,
    [membercode, membercode, membercode]
  );
  return rows;
}

// ---------- Local Sales ----------
export type LocalSale = {
  customer_name?: string;
  quantity: number;
  rate: number;
  amount: number;
  milk_type?: string;
  sale_date?: string;
};

export async function insertLocalSale(s: LocalSale) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO local_sales (client_id, customer_name, quantity, rate, amount, milk_type, sale_date, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [newUUID(), s.customer_name ?? null, s.quantity, s.rate, s.amount, s.milk_type ?? 'mix', s.sale_date ?? new Date().toISOString().slice(0, 10)]
  );
}

export async function recentLocalSales(limit = 30): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM local_sales ORDER BY local_id DESC LIMIT ?`, [limit]);
}

export async function todayLocalSaleTotals(): Promise<{ quantity: number; amount: number; count: number }> {
  const db = await getDb();
  const today = todayIST();
  const r: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(quantity),0) quantity, COALESCE(SUM(amount),0) amount, COUNT(*) count
     FROM local_sales WHERE sale_date = ?`,
    [today]
  );
  return { quantity: r?.quantity ?? 0, amount: r?.amount ?? 0, count: r?.count ?? 0 };
}

export async function unsyncedLocalSales(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM local_sales WHERE synced = 0`);
}

export async function markLocalSaleSynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE local_sales SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}

// ---------- Local Sale Rates ----------
export async function getLocalSaleRates(): Promise<{ milk_type: string; rate_per_litre: number }[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM local_sale_rates ORDER BY milk_type`);
}

export async function setLocalSaleRate(milkType: string, rate: number) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO local_sale_rates (milk_type, rate_per_litre) VALUES (?, ?)`,
    [milkType, rate]
  );
}

// ---------- Kapat (Deductions) ----------
export type LocalKapatItem = {
  name: string;
  type: 'percent' | 'fixed';
  value: number;
};

export async function insertKapatItem(k: LocalKapatItem) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO kapat_items (name, type, value, active, synced) VALUES (?, ?, ?, 1, 0)`,
    [k.name, k.type, k.value]
  );
}

export async function updateKapatItem(localId: number, k: LocalKapatItem) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `UPDATE kapat_items SET name=?, type=?, value=?, synced=0 WHERE local_id=?`,
    [k.name, k.type, k.value, localId]
  );
}

export async function deleteKapatItem(localId: number) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(`DELETE FROM kapat_items WHERE local_id = ?`, [localId]);
  await db.runAsync(`DELETE FROM member_kapat WHERE kapat_id = ?`, [localId]);
}

export async function listKapatItems(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM kapat_items WHERE active = 1 ORDER BY name`);
}

export async function toggleMemberKapat(membercode: number, kapatId: number, active: boolean) {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO member_kapat (membercode, kapat_id, active) VALUES (?, ?, ?)`,
    [membercode, kapatId, active ? 1 : 0]
  );
}

export async function getMemberKapat(membercode: number): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT ki.*, COALESCE(mk.active, 0) as assigned
     FROM kapat_items ki
     LEFT JOIN member_kapat mk ON mk.kapat_id = ki.local_id AND mk.membercode = ?
     WHERE ki.active = 1
     ORDER BY ki.name`,
    [membercode]
  );
}

// ---------- Session Locks ----------
export async function isSessionLocked(date: string, session: number): Promise<boolean> {
  const db = await getDb();
  const r: any = await db.getFirstAsync(
    `SELECT locked FROM session_locks WHERE collect_date = ? AND session = ?`,
    [date, session]
  );
  return r?.locked === 1;
}

export async function lockSession(date: string, session: number) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO session_locks (collect_date, session, locked) VALUES (?, ?, 1)`,
    [date, session]
  );
}

export async function unlockSession(date: string, session: number) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO session_locks (collect_date, session, locked) VALUES (?, ?, 0)`,
    [date, session]
  );
}

// ---------- Datewise Summary Report ----------
export type DatewiseRow = {
  date: string;
  amLitres: number;
  pmLitres: number;
  totalLitres: number;
  avgFat: number;
  amount: number;
  count: number;
};

export async function datewiseSummary(from: string, to: string): Promise<DatewiseRow[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT collect_date as date,
            COALESCE(SUM(CASE WHEN session=0 THEN weight ELSE 0 END),0) amLitres,
            COALESCE(SUM(CASE WHEN session=1 THEN weight ELSE 0 END),0) pmLitres,
            COALESCE(SUM(weight),0) totalLitres,
            COALESCE(AVG(fat),0)    avgFat,
            COALESCE(SUM(price),0)  amount,
            COUNT(*)                count
     FROM milk_collections
     WHERE collect_date BETWEEN ? AND ?
     GROUP BY collect_date
     ORDER BY collect_date DESC`,
    [from, to]
  );
}

// ---------- Union Sales ----------
export type LocalUnionSale = {
  sale_date: string;
  session: number;
  quantity: number;
  fat: number;
  snf: number;
  rate: number;
  amount: number;
  kg_fat: number;
  kg_snf: number;
  union_name?: string;
  note?: string;
  /** 'fat' = priced per fat point per litre, 'litre' = flat ₹/L (pre-1.1.0). */
  rate_basis?: UnionRateBasis;
  /** ₹ per fat point per litre. Mirrors `rate` when basis is 'fat'. */
  fat_rate?: number;
};

export async function insertUnionSale(s: LocalUnionSale) {
  assertUnlocked();
  const db = await getDb();
  const basis = s.rate_basis ?? 'litre';
  await db.runAsync(
    `INSERT INTO union_sales (client_id, sale_date, session, quantity, fat, snf, rate, amount, kg_fat, kg_snf, union_name, note, rate_basis, fat_rate, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [newUUID(), s.sale_date, s.session, s.quantity, s.fat, s.snf, s.rate, s.amount, s.kg_fat, s.kg_snf, s.union_name ?? null, s.note ?? null, basis, s.fat_rate ?? 0]
  );
}

// ---------- Union sale rates (remembered defaults) ----------
export type UnionRateBasis = 'fat' | 'litre';
export type UnionSaleRates = {
  fat_rate: number;
  litre_rate: number;
  rate_basis: UnionRateBasis;
  union_name: string;
};

const UNION_RATE_DEFAULTS: UnionSaleRates = { fat_rate: 0, litre_rate: 0, rate_basis: 'fat', union_name: '' };

/**
 * The operator sells to the same union at the same rate every single day, so
 * these are stored once and auto-filled forever after. Always returns a value:
 * a device that has never opened the rate screen gets the defaults.
 */
export async function getUnionSaleRates(): Promise<UnionSaleRates> {
  const db = await getDb();
  const r: any = await db.getFirstAsync(`SELECT * FROM union_sale_rates WHERE id = 1`);
  if (!r) return { ...UNION_RATE_DEFAULTS };
  return {
    fat_rate: r.fat_rate ?? 0,
    litre_rate: r.litre_rate ?? 0,
    rate_basis: r.rate_basis === 'litre' ? 'litre' : 'fat',
    union_name: r.union_name ?? '',
  };
}

export async function setUnionSaleRates(v: UnionSaleRates) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO union_sale_rates (id, fat_rate, litre_rate, rate_basis, union_name)
     VALUES (1, ?, ?, ?, ?)`,
    [v.fat_rate, v.litre_rate, v.rate_basis, v.union_name.trim() || null]
  );
}

export async function recentUnionSales(limit = 20): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM union_sales ORDER BY local_id DESC LIMIT ?`, [limit]);
}

export async function todayUnionSaleTotals(): Promise<{ quantity: number; amount: number; count: number }> {
  const db = await getDb();
  const today = todayIST();
  const r: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(quantity),0) quantity, COALESCE(SUM(amount),0) amount, COUNT(*) count
     FROM union_sales WHERE sale_date = ?`,
    [today]
  );
  return { quantity: r?.quantity ?? 0, amount: r?.amount ?? 0, count: r?.count ?? 0 };
}

export async function unsyncedUnionSales(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM union_sales WHERE synced = 0`);
}

export async function markUnionSaleSynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE union_sales SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}

// ---------- Farmer Period Report (Payment Bill) ----------
export type FarmerPeriodData = {
  collections: any[];
  payouts: any[];
  ledger: any[];
  totalMilk: number;
  totalDeductions: number;
  totalPayouts: number;
  totalJama: number;
  totalUdhar: number;
  netPayable: number;
};

export async function farmerPeriodReport(membercode: number, from: string, to: string): Promise<FarmerPeriodData> {
  const db = await getDb();
  const collections: any[] = await db.getAllAsync(
    `SELECT * FROM milk_collections WHERE membercode = ? AND collect_date BETWEEN ? AND ? ORDER BY collect_date, session`,
    [membercode, from, to]
  );
  const payouts: any[] = await db.getAllAsync(
    `SELECT * FROM payouts WHERE membercode = ? AND date(paid_at) BETWEEN ? AND ? ORDER BY paid_at`,
    [membercode, from, to]
  );
  const ledger: any[] = await db.getAllAsync(
    `SELECT * FROM ledger_entries WHERE membercode = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date`,
    [membercode, from, to]
  );

  const totalMilk = collections.reduce((s, c) => s + (c.pay_price ?? 0), 0);
  const totalDeductions = collections.reduce((s, c) => s + (c.deduction ?? 0), 0);
  const totalPayouts = payouts.reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalJama = ledger.filter(l => l.kind === 'jama').reduce((s, l) => s + l.amount, 0);
  const totalUdhar = ledger.filter(l => l.kind === 'udhar').reduce((s, l) => s + l.amount, 0);
  const netPayable = totalMilk + totalJama - totalPayouts - totalUdhar;

  return { collections, payouts, ledger, totalMilk, totalDeductions, totalPayouts, totalJama, totalUdhar, netPayable };
}

// ---------- Upsert from server (for pull sync) ----------
export async function upsertMemberFromServer(r: any) {
  const db = await getDb();
  const existing = await db.getFirstAsync(`SELECT local_id FROM members WHERE remote_id = ?`, [r.id]);
  if (existing) return;
  await db.runAsync(
    `INSERT OR IGNORE INTO members (remote_id, membercode, name, name_local, mobile1, animal_type, upi_id, bank_account, ifsc_code, fix_deduction, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [r.id, r.membercode, r.name, r.name_local, r.mobile1, r.animal_type, r.upi_id, r.bank_account, r.ifsc_code, r.fix_deduction ?? 0]
  );
}

export async function upsertCollectionFromServer(r: any) {
  const db = await getDb();
  const existing = await db.getFirstAsync(`SELECT local_id FROM milk_collections WHERE remote_id = ?`, [r.id]);
  if (existing) return;
  await db.runAsync(
    `INSERT INTO milk_collections (remote_id, membercode, session, collect_date, weight, fat, snf, clr, rate, price, kg_fat, kg_snf, deduction, pay_price, animal_type, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [r.id, r.membercode, r.session, r.collect_date, r.weight, r.fat, r.snf, r.clr ?? 0, r.rate, r.price, r.kg_fat, r.kg_snf, r.deduction, r.pay_price, r.animal_type]
  );
}

export async function upsertPayoutFromServer(r: any) {
  const db = await getDb();
  const existing = await db.getFirstAsync(`SELECT local_id FROM payouts WHERE remote_id = ?`, [r.id]);
  if (existing) return;
  await db.runAsync(
    `INSERT INTO payouts (remote_id, membercode, amount, method, upi_ref, note, synced, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [r.id, r.membercode, r.amount, r.method, r.upi_ref, r.note, r.paid_at]
  );
}

export async function upsertLedgerFromServer(r: any) {
  const db = await getDb();
  const existing = await db.getFirstAsync(`SELECT local_id FROM ledger_entries WHERE remote_id = ?`, [r.id]);
  if (existing) return;
  await db.runAsync(
    `INSERT INTO ledger_entries (remote_id, membercode, amount, kind, note, entry_date, synced)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [r.id, r.membercode, r.amount, r.kind, r.note, r.entry_date]
  );
}

export async function upsertLocalSaleFromServer(r: any) {
  const db = await getDb();
  const existing = await db.getFirstAsync(`SELECT local_id FROM local_sales WHERE remote_id = ?`, [r.id]);
  if (existing) return;
  await db.runAsync(
    `INSERT INTO local_sales (remote_id, customer_name, quantity, rate, amount, milk_type, sale_date, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [r.id, r.customer_name, r.quantity, r.rate, r.amount, r.milk_type, r.sale_date]
  );
}

export async function upsertUnionSaleFromServer(r: any) {
  const db = await getDb();
  const existing = await db.getFirstAsync(`SELECT local_id FROM union_sales WHERE remote_id = ?`, [r.id]);
  if (existing) return;
  await db.runAsync(
    `INSERT INTO union_sales (remote_id, sale_date, session, quantity, fat, snf, rate, amount, kg_fat, kg_snf, union_name, note, rate_basis, fat_rate, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    // A row written by a 1.0.0 device has no rate_basis at all — it was priced
    // per litre, so that is what it must come back down as.
    [r.id, r.sale_date, r.session, r.quantity, r.fat, r.snf, r.rate, r.amount, r.kg_fat, r.kg_snf, r.union_name, r.note, r.rate_basis ?? 'litre', r.fat_rate ?? 0]
  );
}

// ============================================================================
// Routine sale — daily home delivery to known customers
//
// A routine customer is NOT a member: members sell milk to the dairy, routine
// customers buy it. Keeping them in their own table is what stops them showing
// up in payouts, collection reports and the farmer list.
//
// Money model: every delivery accrues to a running account and the customer
// settles later (usually monthly), so a delivery is never "paid" in itself.
// Outstanding = all deliveries ever − all payments ever.
// ============================================================================

export type RoutineCustomer = {
  local_id?: number;
  name: string;
  mobile?: string;
  address?: string;
  milk_type: string;
  rate: number;       // 0 = use the local sale rate for this milk type
  am_active: number;  // SQLite has no boolean; 0 | 1
  am_qty: number;
  pm_active: number;
  pm_qty: number;
  active?: number;
};

export async function listRoutineCustomers(includeInactive = false): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM routine_customers ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name COLLATE NOCASE`
  );
}

export async function getRoutineCustomer(localId: number): Promise<any | null> {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM routine_customers WHERE local_id = ?`, [localId]);
}

export async function insertRoutineCustomer(c: RoutineCustomer): Promise<number> {
  assertUnlocked();
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO routine_customers (client_id, name, mobile, address, milk_type, rate, am_active, am_qty, pm_active, pm_qty, active, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
    [newUUID(), c.name, c.mobile ?? null, c.address ?? null, c.milk_type, c.rate, c.am_active, c.am_qty, c.pm_active, c.pm_qty]
  );
  return r.lastInsertRowId;
}

export async function updateRoutineCustomer(localId: number, c: RoutineCustomer) {
  assertUnlocked();
  const db = await getDb();
  // synced = 0 so the edit is pushed on the next sync.
  await db.runAsync(
    `UPDATE routine_customers
        SET name = ?, mobile = ?, address = ?, milk_type = ?, rate = ?,
            am_active = ?, am_qty = ?, pm_active = ?, pm_qty = ?, active = ?,
            synced = 0, updated_at = datetime('now')
      WHERE local_id = ?`,
    [c.name, c.mobile ?? null, c.address ?? null, c.milk_type, c.rate,
     c.am_active, c.am_qty, c.pm_active, c.pm_qty, c.active ?? 1, localId]
  );
}

/** Stop delivering to a customer without losing their history or balance. */
export async function setRoutineCustomerActive(localId: number, active: boolean) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `UPDATE routine_customers SET active = ?, synced = 0, updated_at = datetime('now') WHERE local_id = ?`,
    [active ? 1 : 0, localId]
  );
}

/**
 * The checklist for one date + session: every customer who is meant to get
 * milk in that session, with their standing quantity and whatever was already
 * saved for that day (so re-opening the screen shows the ticks again).
 */
export async function routineChecklist(date: string, session: 0 | 1): Promise<any[]> {
  const db = await getDb();
  const activeCol = session === 0 ? 'am_active' : 'pm_active';
  const qtyCol = session === 0 ? 'am_qty' : 'pm_qty';
  return db.getAllAsync(
    `SELECT c.local_id, c.name, c.mobile, c.address, c.milk_type, c.rate,
            c.${qtyCol} AS standing_qty,
            d.local_id  AS delivery_id,
            d.quantity  AS delivered_qty,
            d.rate      AS delivered_rate,
            d.amount    AS delivered_amount
       FROM routine_customers c
       LEFT JOIN routine_deliveries d
              ON d.customer_id = c.local_id
             AND d.delivery_date = ?
             AND d.session = ?
      WHERE c.active = 1 AND c.${activeCol} = 1
      ORDER BY c.name COLLATE NOCASE`,
    [date, session]
  );
}

export type RoutineDeliveryInput = {
  customer_id: number;
  quantity: number;
  rate: number;
};

/**
 * Save one session's checklist.
 *
 * `rows` is only the customers that were ticked. Anyone previously saved for
 * this date+session and now unticked is deleted, so correcting a mistaken tick
 * actually removes the charge instead of leaving a zero-quantity row behind.
 */
export async function saveRoutineChecklist(
  date: string,
  session: 0 | 1,
  rows: RoutineDeliveryInput[]
): Promise<{ saved: number }> {
  assertUnlocked();
  const db = await getDb();
  const keep = new Set(rows.map((r) => r.customer_id));

  await withTransaction(async () => {
    const existing: any[] = await db.getAllAsync(
      `SELECT local_id, customer_id, remote_id FROM routine_deliveries WHERE delivery_date = ? AND session = ?`,
      [date, session]
    );
    for (const e of existing) {
      if (!keep.has(e.customer_id)) {
        await db.runAsync(`DELETE FROM routine_deliveries WHERE local_id = ?`, [e.local_id]);
        // A row that had already reached the server has to be removed there
        // too; queue it so sync can do that once there is a connection.
        //
        // OR REPLACE, not plain INSERT: unticking the same customer twice
        // before a sync would re-queue the same remote_id and a primary key
        // conflict here would roll back the entire checklist save.
        if (e.remote_id) {
          await db.runAsync(
            `INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`,
            [`deleted_delivery:${e.remote_id}`, date]
          );
        }
      }
    }

    for (const r of rows) {
      const amount = Math.round(r.quantity * r.rate * 100) / 100;
      // ON CONFLICT keeps client_id/remote_id stable when a day is re-saved,
      // so an edit updates the server row instead of creating a second one.
      await db.runAsync(
        `INSERT INTO routine_deliveries (client_id, customer_id, delivery_date, session, quantity, rate, amount, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(customer_id, delivery_date, session)
         DO UPDATE SET quantity = excluded.quantity, rate = excluded.rate,
                       amount = excluded.amount, synced = 0,
                       updated_at = datetime('now')`,
        [newUUID(), r.customer_id, date, session, r.quantity, r.rate, amount]
      );
    }
  });

  return { saved: rows.length };
}

export async function routineDayTotals(date: string): Promise<{ quantity: number; amount: number; count: number }> {
  const db = await getDb();
  const r: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(quantity),0) quantity, COALESCE(SUM(amount),0) amount, COUNT(*) count
       FROM routine_deliveries WHERE delivery_date = ?`,
    [date]
  );
  return { quantity: r?.quantity ?? 0, amount: r?.amount ?? 0, count: r?.count ?? 0 };
}

// ---------- Statement / balance ----------

export type RoutineStatement = {
  deliveries: any[];
  payments: any[];
  litres: number;
  billed: number;
  paid: number;
  /** Lifetime balance, not just this month — what the customer actually owes. */
  outstanding: number;
};

/**
 * One customer's month, plus their true running balance.
 *
 * The listed rows are the chosen month, but `outstanding` deliberately spans
 * all time: a customer who underpaid in June still owes it in July, and a
 * month-scoped balance would quietly forgive it.
 */
export async function routineStatement(customerId: number, month: string): Promise<RoutineStatement> {
  const db = await getDb();
  const like = `${month}%`; // month = 'YYYY-MM'

  const deliveries: any[] = await db.getAllAsync(
    `SELECT * FROM routine_deliveries
      WHERE customer_id = ? AND delivery_date LIKE ?
      ORDER BY delivery_date, session`,
    [customerId, like]
  );
  const payments: any[] = await db.getAllAsync(
    `SELECT * FROM routine_payments
      WHERE customer_id = ? AND paid_on LIKE ?
      ORDER BY paid_on DESC, local_id DESC`,
    [customerId, like]
  );

  const monthly: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(quantity),0) litres, COALESCE(SUM(amount),0) billed
       FROM routine_deliveries WHERE customer_id = ? AND delivery_date LIKE ?`,
    [customerId, like]
  );
  const paidThisMonth: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(amount),0) paid FROM routine_payments WHERE customer_id = ? AND paid_on LIKE ?`,
    [customerId, like]
  );

  const lifetime: any = await db.getFirstAsync(
    `SELECT
       (SELECT COALESCE(SUM(amount),0) FROM routine_deliveries WHERE customer_id = ?) -
       (SELECT COALESCE(SUM(amount),0) FROM routine_payments   WHERE customer_id = ?) AS outstanding`,
    [customerId, customerId]
  );

  return {
    deliveries,
    payments,
    litres: monthly?.litres ?? 0,
    billed: monthly?.billed ?? 0,
    paid: paidThisMonth?.paid ?? 0,
    outstanding: Math.round((lifetime?.outstanding ?? 0) * 100) / 100,
  };
}

/** Lifetime outstanding for every customer, for the list screen. */
export async function routineOutstandingByCustomer(): Promise<Map<number, number>> {
  const db = await getDb();
  const rows: any[] = await db.getAllAsync(
    `SELECT c.local_id,
            COALESCE((SELECT SUM(amount) FROM routine_deliveries WHERE customer_id = c.local_id), 0) -
            COALESCE((SELECT SUM(amount) FROM routine_payments   WHERE customer_id = c.local_id), 0) AS outstanding
       FROM routine_customers c`
  );
  return new Map(rows.map((r) => [r.local_id, Math.round((r.outstanding ?? 0) * 100) / 100]));
}

export async function insertRoutinePayment(p: { customer_id: number; amount: number; method: string; note?: string; paid_on?: string }) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO routine_payments (client_id, customer_id, amount, method, note, paid_on, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [newUUID(), p.customer_id, p.amount, p.method, p.note ?? null, p.paid_on ?? todayIST()]
  );
}

export async function deleteRoutinePayment(localId: number) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(`DELETE FROM routine_payments WHERE local_id = ?`, [localId]);
}

// ---------- Routine sync plumbing ----------

export async function unsyncedRoutineCustomers(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM routine_customers WHERE synced = 0`);
}

export async function markRoutineCustomerSynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE routine_customers SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}

/**
 * Deliveries whose customer already exists on the server.
 *
 * The join is the point: a delivery references its customer by the server's
 * uuid, so a delivery for a customer that hasn't been pushed yet has nothing
 * to point at. Those are simply left for the next sync, by which time the
 * customer push (which runs first) will have given them a remote_id.
 */
export async function unsyncedRoutineDeliveries(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT d.*, c.remote_id AS customer_remote_id
       FROM routine_deliveries d
       JOIN routine_customers c ON c.local_id = d.customer_id
      WHERE d.synced = 0 AND c.remote_id IS NOT NULL`
  );
}

export async function markRoutineDeliverySynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE routine_deliveries SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}

export async function unsyncedRoutinePayments(): Promise<any[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT p.*, c.remote_id AS customer_remote_id
       FROM routine_payments p
       JOIN routine_customers c ON c.local_id = p.customer_id
      WHERE p.synced = 0 AND c.remote_id IS NOT NULL`
  );
}

export async function markRoutinePaymentSynced(localId: number, remoteId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE routine_payments SET synced = 1, remote_id = ? WHERE local_id = ?`, [remoteId, localId]);
}

/** remote_ids of deliveries deleted locally that still need deleting server-side. */
export async function pendingDeliveryDeletions(): Promise<string[]> {
  const db = await getDb();
  const rows: any[] = await db.getAllAsync(
    `SELECT key FROM app_meta WHERE key LIKE 'deleted_delivery:%'`
  );
  return rows.map((r) => String(r.key).slice('deleted_delivery:'.length));
}

export async function clearDeliveryDeletion(remoteId: string) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM app_meta WHERE key = ?`, [`deleted_delivery:${remoteId}`]);
}

export async function upsertRoutineCustomerFromServer(r: any) {
  const db = await getDb();
  const existing: any = await db.getFirstAsync(
    `SELECT local_id FROM routine_customers WHERE remote_id = ? OR client_id = ?`,
    [r.id, r.client_id]
  );
  if (existing) {
    await db.runAsync(
      `UPDATE routine_customers
          SET remote_id = ?, name = ?, mobile = ?, address = ?, milk_type = ?, rate = ?,
              am_active = ?, am_qty = ?, pm_active = ?, pm_qty = ?, active = ?, synced = 1
        WHERE local_id = ?`,
      [r.id, r.name, r.mobile, r.address, r.milk_type ?? 'mix', r.rate ?? 0,
       r.am_active ? 1 : 0, r.am_qty ?? 0, r.pm_active ? 1 : 0, r.pm_qty ?? 0,
       r.active === false ? 0 : 1, existing.local_id]
    );
    return;
  }
  await db.runAsync(
    `INSERT INTO routine_customers (remote_id, client_id, name, mobile, address, milk_type, rate, am_active, am_qty, pm_active, pm_qty, active, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [r.id, r.client_id, r.name, r.mobile, r.address, r.milk_type ?? 'mix', r.rate ?? 0,
     r.am_active ? 1 : 0, r.am_qty ?? 0, r.pm_active ? 1 : 0, r.pm_qty ?? 0, r.active === false ? 0 : 1]
  );
}

/** Map a server customer uuid to its local row, for pulled deliveries/payments. */
async function localCustomerIdFor(remoteCustomerId: string): Promise<number | null> {
  const db = await getDb();
  const c: any = await db.getFirstAsync(`SELECT local_id FROM routine_customers WHERE remote_id = ?`, [remoteCustomerId]);
  return c?.local_id ?? null;
}

export async function upsertRoutineDeliveryFromServer(r: any) {
  const db = await getDb();
  const customerId = await localCustomerIdFor(r.customer_id);
  // Customers are pulled before deliveries, so a miss here means the customer
  // row is genuinely gone; skipping beats inserting an orphan.
  if (!customerId) return;
  await db.runAsync(
    `INSERT INTO routine_deliveries (remote_id, client_id, customer_id, delivery_date, session, quantity, rate, amount, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(customer_id, delivery_date, session)
     DO UPDATE SET remote_id = excluded.remote_id, quantity = excluded.quantity,
                   rate = excluded.rate, amount = excluded.amount, synced = 1`,
    [r.id, r.client_id, customerId, r.delivery_date, r.session, r.quantity, r.rate, r.amount]
  );
}

export async function upsertRoutinePaymentFromServer(r: any) {
  const db = await getDb();
  const existing = await db.getFirstAsync(`SELECT local_id FROM routine_payments WHERE remote_id = ?`, [r.id]);
  if (existing) return;
  const customerId = await localCustomerIdFor(r.customer_id);
  if (!customerId) return;
  await db.runAsync(
    `INSERT INTO routine_payments (remote_id, client_id, customer_id, amount, method, note, paid_on, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [r.id, r.client_id, customerId, r.amount, r.method, r.note, r.paid_on]
  );
}
