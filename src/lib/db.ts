// ============================================================================
// Offline-first local store (expo-sqlite).
//
// The app writes every entry here FIRST (works with no internet), then sync.ts
// pushes rows where synced = 0 up to Supabase — mirroring the original app's
// `synflags`/`vd_flgs` dirty-row mechanism.
// ============================================================================
import * as SQLite from 'expo-sqlite';
import { assertUnlocked } from './subscription';

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
  `);

  // lightweight migrations for installs created before a column existed
  // (ALTER throws if the column is already there — safe to ignore)
  try { await _db.execAsync(`ALTER TABLE members ADD COLUMN upi_id TEXT`); } catch {}
  try { await _db.execAsync(`ALTER TABLE members ADD COLUMN client_id TEXT`); } catch {}
  try { await _db.execAsync(`ALTER TABLE payouts ADD COLUMN client_id TEXT`); } catch {}
  try { await _db.execAsync(`ALTER TABLE milk_collections ADD COLUMN client_id TEXT`); } catch {}
  try { await _db.execAsync(`ALTER TABLE ledger_entries ADD COLUMN client_id TEXT`); } catch {}
  try { await _db.execAsync(`ALTER TABLE local_sales ADD COLUMN client_id TEXT`); } catch {}
  try { await _db.execAsync(`ALTER TABLE union_sales ADD COLUMN client_id TEXT`); } catch {}
  try { await _db.execAsync(`ALTER TABLE rate_chart_entries ADD COLUMN fat_type TEXT DEFAULT 'mix'`); } catch {}

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
export async function inventoryTotals(): Promise<{ collected: number; unionSold: number; localSold: number; remaining: number }> {
  const db = await getDb();
  const col: any = await db.getFirstAsync(`SELECT COALESCE(SUM(weight),0) val FROM milk_collections`);
  const union: any = await db.getFirstAsync(`SELECT COALESCE(SUM(quantity),0) val FROM union_sales`);
  const local: any = await db.getFirstAsync(`SELECT COALESCE(SUM(quantity),0) val FROM local_sales`);
  const collected = col?.val ?? 0;
  const unionSold = union?.val ?? 0;
  const localSold = local?.val ?? 0;
  return {
    collected,
    unionSold,
    localSold,
    remaining: collected - unionSold - localSold,
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
  return (a?.c ?? 0) + (b?.c ?? 0) + (c?.c ?? 0) + (d?.c ?? 0) + (e?.c ?? 0) + (f?.c ?? 0);
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
};

export async function insertUnionSale(s: LocalUnionSale) {
  assertUnlocked();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO union_sales (client_id, sale_date, session, quantity, fat, snf, rate, amount, kg_fat, kg_snf, union_name, note, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [newUUID(), s.sale_date, s.session, s.quantity, s.fat, s.snf, s.rate, s.amount, s.kg_fat, s.kg_snf, s.union_name ?? null, s.note ?? null]
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
    `INSERT INTO union_sales (remote_id, sale_date, session, quantity, fat, snf, rate, amount, kg_fat, kg_snf, union_name, note, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [r.id, r.sale_date, r.session, r.quantity, r.fat, r.snf, r.rate, r.amount, r.kg_fat, r.kg_snf, r.union_name, r.note]
  );
}
