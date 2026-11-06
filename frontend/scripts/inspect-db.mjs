import process from "node:process";
import pg from "pg";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL must be configured before inspecting the database.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  const summary = await pool.query(`
    SELECT
      u.email,
      COUNT(mp.gmail_message_id)::INTEGER AS classified_messages,
      COUNT(*) FILTER (WHERE mp.priority = 'urgent')::INTEGER AS urgent,
      COUNT(*) FILTER (WHERE mp.priority = 'fyi')::INTEGER AS fyi,
      COUNT(*) FILTER (WHERE mp.priority = 'low')::INTEGER AS low
    FROM users u
    LEFT JOIN message_priorities mp ON mp.user_id = u.id
    GROUP BY u.id, u.email
    ORDER BY u.email
  `);

  const recentHistory = await pool.query(`
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
  `);

  console.log("Current classification totals");
  console.table(summary.rows);
  console.log("Most recent priority changes");
  console.table(recentHistory.rows);
} finally {
  await pool.end();
}
