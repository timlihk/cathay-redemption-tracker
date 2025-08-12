import Database from 'better-sqlite3';
import { WatchItem } from './types.js';

const db = new Database('./data.sqlite');

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  cathay_member TEXT,
  cathay_pass_enc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  num_adults INTEGER NOT NULL DEFAULT 1,
  num_children INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL,
  nonstop_only INTEGER NOT NULL DEFAULT 0,
  min_cabin TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS results_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  from_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_results_key ON results_cache(date, from_code, to_code);
`);

export function upsertUser(email: string, cathayMember?: string, cathayPassEnc?: string) {
  const row = db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: number } | undefined;
  if (row) {
    if (cathayMember || cathayPassEnc) {
      db.prepare('UPDATE users SET cathay_member=COALESCE(?, cathay_member), cathay_pass_enc=COALESCE(?, cathay_pass_enc) WHERE id=?')
        .run(cathayMember || null, cathayPassEnc || null, row.id);
    }
    return row.id;
  }
  const info = db.prepare('INSERT INTO users (email, cathay_member, cathay_pass_enc) VALUES (?,?,?)')
    .run(email, cathayMember || null, cathayPassEnc || null);
  return info.lastInsertRowid as number;
}

export function getUserById(id: number): { id: number; email: string; cathay_member?: string; cathay_pass_enc?: string } | undefined {
  const r = db.prepare('SELECT id, email, cathay_member, cathay_pass_enc FROM users WHERE id=?').get(id) as any;
  return r ? { id: r.id, email: r.email, cathay_member: r.cathay_member || undefined, cathay_pass_enc: r.cathay_pass_enc || undefined } : undefined;
}

export function addWatch(userId: number, input: Omit<WatchItem, 'id' | 'createdAt'>) {
  const stmt = db.prepare(`INSERT INTO watches
    (user_id, from_code, to_code, start_date, end_date, num_adults, num_children, email, nonstop_only, min_cabin)
    VALUES (@userId, @from, @to, @startDate, @endDate, @numAdults, @numChildren, @email, @nonstopOnly, @minCabin)`);
  const info = stmt.run({ userId, ...input });
  return info.lastInsertRowid as number;
}

export function deleteWatch(id: number) {
  db.prepare('DELETE FROM watches WHERE id=?').run(id);
}

export function listWatches(userId?: number): WatchItem[] {
  const rows = userId
    ? db.prepare('SELECT * FROM watches WHERE user_id=? ORDER BY id DESC').all(userId)
    : db.prepare('SELECT * FROM watches ORDER BY id DESC').all();
  return rows.map((r: any) => ({
    id: r.id,
    from: r.from_code,
    to: r.to_code,
    startDate: r.start_date,
    endDate: r.end_date,
    numAdults: r.num_adults,
    numChildren: r.num_children,
    email: r.email,
    nonstopOnly: r.nonstop_only,
    minCabin: r.min_cabin ?? undefined,
    createdAt: r.created_at,
  }));
}

export function upsertCache(date: string, from: string, to: string, payload: string) {
  const now = Date.now();
  const existing = db
    .prepare('SELECT id FROM results_cache WHERE date=? AND from_code=? AND to_code=?')
    .get(date, from, to) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE results_cache SET payload=?, created_at=? WHERE id=?').run(payload, now, existing.id);
  } else {
    db.prepare('INSERT INTO results_cache (date, from_code, to_code, payload, created_at) VALUES (?,?,?,?,?)')
      .run(date, from, to, payload, now);
  }
}

export function getCached(date: string, from: string, to: string, maxAgeMs: number) {
  const row = db
    .prepare('SELECT payload, created_at FROM results_cache WHERE date=? AND from_code=? AND to_code=?')
    .get(date, from, to) as { payload: string; created_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.created_at > maxAgeMs) return null;
  return row.payload as string;
}

export default db;