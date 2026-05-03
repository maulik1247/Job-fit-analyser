import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Lazy-load native module so `/api/analyse` works even if SQLite fails to load (e.g. some serverless). */
function SqliteDatabase() {
  return require("better-sqlite3");
}

/** On Vercel, only /tmp is writable; DB is ephemeral across cold starts. */
const dbPath =
  process.env.DATABASE_PATH?.trim() ||
  (process.env.VERCEL
    ? "/tmp/jd-analyser.db"
    : path.join(__dirname, "data", "app.db"));

let db;

function columnExists(database, table, name) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === name);
}

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

function migrateHistoryResumeColumns(database) {
  if (!columnExists(database, "history_entries", "resume_id")) {
    database.exec("ALTER TABLE history_entries ADD COLUMN resume_id TEXT");
  }
  if (!columnExists(database, "history_entries", "resume_title")) {
    database.exec("ALTER TABLE history_entries ADD COLUMN resume_title TEXT");
  }
  if (!columnExists(database, "history_entries", "resume_body")) {
    database.exec("ALTER TABLE history_entries ADD COLUMN resume_body TEXT");
  }
}

export function getDb() {
  if (!db) {
    const Database = SqliteDatabase();
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
    db.exec(`
      CREATE TABLE IF NOT EXISTS resumes (
        id TEXT PRIMARY KEY,
        clerk_user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resumes_clerk ON resumes(clerk_user_id, updated_at DESC);
    `);
    migrateHistoryResumeColumns(db);
  }
  return db;
}

const MAX_HISTORY = 50;

export function insertHistoryEntry(clerkUserId, entry) {
  const database = getDb();
  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO history_entries (id, clerk_user_id, company_name, jd_text, result_json, created_at, resume_id, resume_title, resume_body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        clerkUserId,
        entry.companyName,
        entry.jdText,
        JSON.stringify(entry.result),
        entry.createdAt,
        entry.resumeId ?? null,
        entry.resumeTitle ?? null,
        entry.resumeBody ?? null
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
      `SELECT id, company_name as companyName, jd_text as jdText, result_json as resultJson, created_at as createdAt,
              resume_id as resumeId, resume_title as resumeTitle, resume_body as resumeBody
       FROM history_entries WHERE clerk_user_id = ? ORDER BY created_at DESC`
    )
    .all(clerkUserId);
  return rows.map((row) => ({
    id: row.id,
    companyName: row.companyName,
    jdText: row.jdText,
    result: JSON.parse(row.resultJson),
    createdAt: row.createdAt,
    resumeId: row.resumeId,
    resumeTitle: row.resumeTitle,
    resumeBody: row.resumeBody,
  }));
}

const MAX_RESUMES = 30;

export function listResumesForUser(clerkUserId) {
  return getDb()
    .prepare(
      `SELECT id, title, body, created_at as createdAt, updated_at as updatedAt
       FROM resumes WHERE clerk_user_id = ? ORDER BY updated_at DESC`
    )
    .all(clerkUserId);
}

export function getResumeForUser(clerkUserId, id) {
  const row = getDb()
    .prepare(
      `SELECT id, title, body, created_at as createdAt, updated_at as updatedAt
       FROM resumes WHERE id = ? AND clerk_user_id = ?`
    )
    .get(id, clerkUserId);
  return row ?? null;
}

export function insertResume(clerkUserId, { id, title, body, createdAt, updatedAt }) {
  const database = getDb();
  const n = database
    .prepare("SELECT COUNT(*) as c FROM resumes WHERE clerk_user_id = ?")
    .get(clerkUserId).c;
  if (n >= MAX_RESUMES) {
    const oldest = database
      .prepare(
        `SELECT id FROM resumes WHERE clerk_user_id = ? ORDER BY updated_at ASC LIMIT 1`
      )
      .get(clerkUserId);
    if (oldest) {
      database
        .prepare("DELETE FROM resumes WHERE id = ? AND clerk_user_id = ?")
        .run(oldest.id, clerkUserId);
    }
  }
  database
    .prepare(
      `INSERT INTO resumes (id, clerk_user_id, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, clerkUserId, title, body, createdAt, updatedAt);
}

export function updateResume(
  clerkUserId,
  id,
  { title, body, updatedAt }
) {
  const row = getDb()
    .prepare(
      "SELECT id FROM resumes WHERE id = ? AND clerk_user_id = ?"
    )
    .get(id, clerkUserId);
  if (!row) return false;
  getDb()
    .prepare(
      `UPDATE resumes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND clerk_user_id = ?`
    )
    .run(title, body, updatedAt, id, clerkUserId);
  return true;
}

export function deleteResume(clerkUserId, id) {
  const info = getDb()
    .prepare("DELETE FROM resumes WHERE id = ? AND clerk_user_id = ?")
    .run(id, clerkUserId);
  return info.changes > 0;
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
