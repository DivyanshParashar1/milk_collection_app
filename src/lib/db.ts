// ============================================================================
// Offline-first local store (expo-sqlite).
//
// The app writes every entry here FIRST (works with no internet), then sync.ts
// pushes rows where synced = 0 up to Supabase — mirroring the original app's
// `synflags`/`vd_flgs` dirty-row mechanism.
// ============================================================================
import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('milkapp.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS members (
      local_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_id    TEXT,
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
  `);

  // lightweight migrations for installs created before a column existed
  // (ALTER throws if the column is already there — safe to ignore)
  try { await _db.execAsync(`ALTER TABLE members ADD COLUMN upi_id TEXT`); } catch {}

  return _db;
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
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO members
      (membercode, name, name_local, mobile1, animal_type, upi_id, bank_account, ifsc_code, fix_deduction, synced, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
    [
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

/** All members with their current balance (milk value earned − paid out). */
export async function membersWithBalances(): Promise<any[]> {
  const db = await getDb();
  const members: any[] = await db.getAllAsync(`SELECT * FROM members ORDER BY membercode`);
  const earned: any[] = await db.getAllAsync(
    `SELECT membercode, COALESCE(SUM(pay_price),0) v FROM milk_collections GROUP BY membercode`
  );
  const paid: any[] = await db.getAllAsync(
    `SELECT membercode, COALESCE(SUM(amount),0) v FROM payouts GROUP BY membercode`
  );
  const em = new Map(earned.map((r) => [r.membercode, r.v]));
  const pm = new Map(paid.map((r) => [r.membercode, r.v]));
  return members.map((m) => ({
    ...m,
    balance: Math.max(0, (em.get(m.membercode) ?? 0) - (pm.get(m.membercode) ?? 0)),
  }));
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
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO milk_collections
      (membercode, session, collect_date, weight, fat, snf, clr, rate, price, kg_fat, kg_snf, deduction, pay_price, animal_type, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
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
  const db = await getDb();
  await db.runAsync(
    `UPDATE milk_collections SET weight=?, fat=?, snf=?, rate=?, price=?,
       kg_fat=?, kg_snf=?, deduction=?, pay_price=? WHERE local_id=?`,
    [c.weight, c.fat, c.snf, c.rate, c.price, c.kg_fat, c.kg_snf, c.deduction, c.pay_price, localId]
  );
}

export async function deleteCollectionLocal(localId: number) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM milk_collections WHERE local_id = ?`, [localId]);
}

/** Today's totals for the dashboard. */
export async function todayTotals(): Promise<{ litres: number; amount: number; count: number }> {
  const db = await getDb();
  const row: any = await db.getFirstAsync(
    `SELECT COALESCE(SUM(weight),0) litres, COALESCE(SUM(price),0) amount, COUNT(*) count
     FROM milk_collections WHERE collect_date = date('now')`
  );
  return { litres: row?.litres ?? 0, amount: row?.amount ?? 0, count: row?.count ?? 0 };
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
export async function setRateChart(entries: { fat: number; snf?: number | null; rate: number }[]) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM rate_chart_entries`);
  for (const e of entries) {
    await db.runAsync(
      `INSERT INTO rate_chart_entries (fat, snf, rate) VALUES (?, ?, ?)`,
      [e.fat, e.snf ?? null, e.rate]
    );
  }
}

export async function getRateChart(): Promise<{ fat: number; snf?: number | null; rate: number }[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT fat, snf, rate FROM rate_chart_entries ORDER BY fat`);
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
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO payouts (membercode, amount, method, upi_ref, note, synced)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [p.membercode, p.amount, p.method, p.upi_ref ?? null, p.note ?? null]
  );
}

/**
 * How much this farmer is still owed = total milk value (pay_price) minus what
 * has already been paid out. Used to pre-fill the payout amount.
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
  return Math.max(0, (earned?.v ?? 0) - (paid?.v ?? 0));
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
  return (a?.c ?? 0) + (b?.c ?? 0) + (c?.c ?? 0);
}
