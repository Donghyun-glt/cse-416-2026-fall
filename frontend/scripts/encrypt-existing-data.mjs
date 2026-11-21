// One-time: encrypts user content that was stored as plain text before
// field-level encryption was introduced (src/lib/data-vault.ts).
//   node --env-file=<env file> scripts/encrypt-existing-data.mjs           counts only, changes nothing
//   node --env-file=<env file> scripts/encrypt-existing-data.mjs --apply   encrypts in one transaction
// The env file must hold the same DATABASE_URL and DATA_ENCRYPTION_KEY (or
// SESSION_SECRET) as the deployed app, or the app will not be able to read the result.
// Safe to run again: values that are already encrypted are skipped.
import process from "node:process";
import pg from "pg";
import { isSealed, lookupToken, seal, sealJson } from "../src/lib/data-vault.ts";

const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) { console.error("DATABASE_URL must be configured."); process.exit(1); }
const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();
const plainText = (value) => typeof value === "string" && value !== "" && !isSealed(value);
const plainJson = (value) => value && typeof value === "object" && !isSealed(value.enc);
let total = 0;
const report = (table, count) => { total += count; console.log(`${table}: ${count} row(s) ${apply ? "encrypted" : "to encrypt"}`); };

try {
  await client.query("BEGIN");

  let count = 0;
  for (const row of (await client.query("SELECT user_id, gmail_message_id, tone, length, instructions, draft FROM reply_drafts")).rows) {
    const draft = plainText(row.draft) ? seal(row.user_id, `reply_drafts.draft:${row.gmail_message_id}`, row.draft) : row.draft;
    const instructions = row.instructions && !row.instructions.startsWith("h:v1:") ? lookupToken(row.user_id, "reply_drafts.instructions", row.instructions) : row.instructions;
    if (draft === row.draft && instructions === row.instructions) continue;
    count++;
    if (apply) await client.query("UPDATE reply_drafts SET draft = $1, instructions = $2 WHERE user_id = $3 AND gmail_message_id = $4 AND tone = $5 AND length = $6 AND instructions = $7",
      [draft, instructions, row.user_id, row.gmail_message_id, row.tone, row.length, row.instructions]);
  }
  report("reply_drafts", count);

  count = 0;
  for (const row of (await client.query("SELECT user_id, gmail_message_id, draft, instructions FROM reply_panel_states")).rows) {
    if (!plainText(row.draft) && !plainText(row.instructions)) continue;
    count++;
    if (apply) await client.query("UPDATE reply_panel_states SET draft = $1, instructions = $2 WHERE user_id = $3 AND gmail_message_id = $4", [
      plainText(row.draft) ? seal(row.user_id, `reply_panel_states.draft:${row.gmail_message_id}`, row.draft) : row.draft,
      isSealed(row.instructions) ? row.instructions : seal(row.user_id, `reply_panel_states.instructions:${row.gmail_message_id}`, row.instructions ?? ""),
      row.user_id, row.gmail_message_id]);
  }
  report("reply_panel_states", count);

  count = 0;
  for (const row of (await client.query("SELECT user_id, gmail_message_id, analysis FROM message_insights")).rows) {
    if (!plainJson(row.analysis)) continue;
    count++;
    if (apply) await client.query("UPDATE message_insights SET analysis = $1::jsonb WHERE user_id = $2 AND gmail_message_id = $3",
      [sealJson(row.user_id, `message_insights.analysis:${row.gmail_message_id}`, row.analysis), row.user_id, row.gmail_message_id]);
  }
  report("message_insights", count);

  count = 0;
  for (const row of (await client.query("SELECT user_id, gmail_message_id, candidate_key, details FROM calendar_event_states")).rows) {
    if (!plainJson(row.details)) continue;
    count++;
    if (apply) await client.query("UPDATE calendar_event_states SET details = $1::jsonb WHERE user_id = $2 AND gmail_message_id = $3 AND candidate_key = $4",
      [sealJson(row.user_id, `calendar_event_states.details:${row.gmail_message_id}:${row.candidate_key}`, row.details), row.user_id, row.gmail_message_id, row.candidate_key]);
  }
  report("calendar_event_states", count);

  const exists = async (table) => (await client.query("SELECT to_regclass($1) AS name", [table])).rows[0].name !== null;
  if (await exists("user_about")) {
    count = 0;
    const fields = ["role", "organization", "department", "interests", "notes"];
    for (const row of (await client.query("SELECT user_id, role, organization, department, interests, notes FROM user_about")).rows) {
      if (!fields.some((name) => plainText(row[name]))) continue;
      count++;
      if (apply) await client.query("UPDATE user_about SET role = $1, organization = $2, department = $3, interests = $4, notes = $5 WHERE user_id = $6",
        [...fields.map((name) => plainText(row[name]) ? seal(row.user_id, `user_about.${name}`, row[name]) : row[name]), row.user_id]);
    }
    report("user_about", count);
  }
  if (await exists("todo_items")) {
    count = 0;
    for (const row of (await client.query("SELECT user_id, gmail_message_id, task FROM todo_items")).rows) {
      if (!plainText(row.task)) continue;
      count++;
      if (apply) await client.query("UPDATE todo_items SET task = $1 WHERE user_id = $2 AND gmail_message_id = $3",
        [seal(row.user_id, `todo_items.task:${row.gmail_message_id}`, row.task), row.user_id, row.gmail_message_id]);
    }
    report("todo_items", count);
  }

  await client.query(apply ? "COMMIT" : "ROLLBACK");
  console.log(apply ? `Done: ${total} row(s) encrypted.` : `Dry run: ${total} row(s) would be encrypted. Run again with --apply to do it.`);
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Nothing was changed.", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
