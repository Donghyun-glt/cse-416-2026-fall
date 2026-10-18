import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.MAILFLOW_DB_PATH
  ? path.resolve(process.env.MAILFLOW_DB_PATH)
  : path.join(process.cwd(), "data", "mailflow.db");

if (!existsSync(databasePath)) {
  console.log(`No MailFlow database exists at ${databasePath}. Load Gmail in the app first.`);
  process.exit(0);
}

const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const summary = database.prepare(`
    SELECT
      u.email,
      COUNT(mp.gmail_message_id) AS labeled_messages,
      SUM(CASE WHEN mp.priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
      SUM(CASE WHEN mp.priority = 'fyi' THEN 1 ELSE 0 END) AS fyi,
      SUM(CASE WHEN mp.priority = 'low' THEN 1 ELSE 0 END) AS low
    FROM users u
    LEFT JOIN message_priorities mp ON mp.user_id = u.id
    GROUP BY u.id, u.email
    ORDER BY u.email
  `).all();

  const recentHistory = database.prepare(`
    SELECT
      u.email,
      pe.gmail_message_id,
      pe.previous_priority,
      pe.new_priority,
      pe.source,
      pe.reason,
      pe.created_at
    FROM priority_events pe
    JOIN users u ON u.id = pe.user_id
    ORDER BY pe.created_at DESC
    LIMIT 25
  `).all();

  console.log(`MailFlow database: ${databasePath}`);
  console.log("\nCurrent classification totals");
  console.table(summary);
  console.log("\nMost recent priority changes");
  console.table(recentHistory);
} finally {
  database.close();
}
