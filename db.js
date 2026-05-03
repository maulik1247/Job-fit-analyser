import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath =
  process.env.DATABASE_PATH || path.join(__dirname, "data", "app.db");

let db;

function migrateIfNeeded(database) {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='history_entries'"
    )
    .get();
  if (!row) return;
  const cols = database.prepare("PRAGMA table_info(history_entries)").all();
  const hasClerk = cols.some((c) => c.name === "clerk_user_id");
  if (!hasClerk) {
    database.exec(
      "DROP TABLE IF EXISTS history_entries; DROP TABLE IF EXISTS users;"
    );
  }
}

export function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    migrateIfNeeded(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS history_entries (
        id TEXT PRIMARY KEY,
        clerk_user_id TEXT NOT NULL,
        company_name TEXT NOT NULL,
        jd_text TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_clerk ON history_entries(clerk_user_id, created_at DESC);
    `);
  }
  return db;
}

const MAX_HISTORY = 50;

export function insertHistoryEntry(clerkUserId, entry) {
  const database = getDb();
  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO history_entries (id, clerk_user_id, company_name, jd_text, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        clerkUserId,
        entry.companyName,
        entry.jdText,
        JSON.stringify(entry.result),
        entry.createdAt
      );
    const count = database
      .prepare(
        "SELECT COUNT(*) as c FROM history_entries WHERE clerk_user_id = ?"
      )
      .get(clerkUserId).c;
    if (count > MAX_HISTORY) {
      const drop = database
        .prepare(
          `SELECT id FROM history_entries WHERE clerk_user_id = ? ORDER BY created_at ASC LIMIT ?`
        )
        .all(clerkUserId, count - MAX_HISTORY);
      const del = database.prepare("DELETE FROM history_entries WHERE id = ?");
      for (const row of drop) del.run(row.id);
    }
  });
  tx();
}

export function listHistoryForUser(clerkUserId) {
  const rows = getDb()
    .prepare(
      `SELECT id, company_name as companyName, jd_text as jdText, result_json as resultJson, created_at as createdAt
       FROM history_entries WHERE clerk_user_id = ? ORDER BY created_at DESC`
    )
    .all(clerkUserId);
  return rows.map((row) => ({
    id: row.id,
    companyName: row.companyName,
    jdText: row.jdText,
    result: JSON.parse(row.resultJson),
    createdAt: row.createdAt,
  }));
}

export function deleteHistoryEntry(clerkUserId, entryId) {
  const info = getDb()
    .prepare(
      "DELETE FROM history_entries WHERE id = ? AND clerk_user_id = ?"
    )
    .run(entryId, clerkUserId);
  return info.changes > 0;
}

export function clearHistoryForUser(clerkUserId) {
  getDb()
    .prepare("DELETE FROM history_entries WHERE clerk_user_id = ?")
    .run(clerkUserId);
}
