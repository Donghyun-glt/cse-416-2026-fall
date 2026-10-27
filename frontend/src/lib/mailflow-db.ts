import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Priority, PrioritySignals } from "./mail-priority";

export type PrioritySource = "automatic" | "manual" | "gmail_label";

type DatabaseState = {
  database?: DatabaseSync;
};

const globalWithDatabase = globalThis as typeof globalThis & {
  mailflowDatabaseState?: DatabaseState;
};

const databaseState = globalWithDatabase.mailflowDatabaseState
  ?? (globalWithDatabase.mailflowDatabaseState = {});

function getDatabase() {
  if (databaseState.database) return databaseState.database;

  const configuredPath = process.env.MAILFLOW_DB_PATH?.trim();
  // Vercel's project directory is read-only, and only the OS temp directory is
  // writable there. It is per-instance and temporary, but priorities also live
  // in Gmail labels, so the app keeps working until a hosted database replaces it.
  const databasePath = configuredPath
    ? path.resolve(configuredPath)
    : process.env.VERCEL
      ? path.join(tmpdir(), "mailflow.db")
      : path.join(process.cwd(), "data", "mailflow.db");

  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_priorities (
      user_id INTEGER NOT NULL,
      gmail_message_id TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('urgent', 'fyi', 'low')),
      source TEXT NOT NULL CHECK (source IN ('automatic', 'manual', 'gmail_label')),
      reason TEXT NOT NULL,
      signals_json TEXT,
      classified_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (user_id, gmail_message_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS priority_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      gmail_message_id TEXT NOT NULL,
      previous_priority TEXT CHECK (previous_priority IN ('urgent', 'fyi', 'low')),
      new_priority TEXT NOT NULL CHECK (new_priority IN ('urgent', 'fyi', 'low')),
      source TEXT NOT NULL CHECK (source IN ('automatic', 'manual', 'gmail_label')),
      reason TEXT NOT NULL,
      signals_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS priority_events_message_idx
      ON priority_events(user_id, gmail_message_id, created_at);
  `);

  databaseState.database = database;
  return database;
}

export function upsertUser(email: string, displayName?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("A Gmail email address is required to store MailFlow data");

  const database = getDatabase();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, users.display_name),
      updated_at = excluded.updated_at
  `).run(normalizedEmail, displayName?.trim() || null, now, now);

  const user = database.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail) as { id: number } | undefined;
  if (!user) throw new Error("MailFlow could not create the local user record");
  return user.id;
}

export function recordPriority(input: {
  userId: number;
  gmailMessageId: string;
  priority: Priority;
  source: PrioritySource;
  reason: string;
  signals?: PrioritySignals;
}) {
  const database = getDatabase();
  const now = new Date().toISOString();
  const existing = database.prepare(`
    SELECT priority FROM message_priorities
    WHERE user_id = ? AND gmail_message_id = ?
  `).get(input.userId, input.gmailMessageId) as { priority: Priority } | undefined;

  if (existing?.priority === input.priority) {
    database.prepare(`
      UPDATE message_priorities SET last_seen_at = ?
      WHERE user_id = ? AND gmail_message_id = ?
    `).run(now, input.userId, input.gmailMessageId);
    return;
  }

  const signalsJson = input.signals ? JSON.stringify(input.signals) : null;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO message_priorities (
        user_id, gmail_message_id, priority, source, reason, signals_json,
        classified_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, gmail_message_id) DO UPDATE SET
        priority = excluded.priority,
        source = excluded.source,
        reason = excluded.reason,
        signals_json = excluded.signals_json,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at
    `).run(
      input.userId,
      input.gmailMessageId,
      input.priority,
      input.source,
      input.reason,
      signalsJson,
      now,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO priority_events (
        user_id, gmail_message_id, previous_priority, new_priority,
        source, reason, signals_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.userId,
      input.gmailMessageId,
      existing?.priority ?? null,
      input.priority,
      input.source,
      input.reason,
      signalsJson,
      now,
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
