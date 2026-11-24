// One-time: encrypts user content that was stored as plain text before
// field-level encryption was introduced (src/lib/data-vault.ts).
//   node --env-file=<env file> scripts/encrypt-existing-data.mjs           counts only, changes nothing
//   node --env-file=<env file> scripts/encrypt-existing-data.mjs --apply   encrypts in one transaction
// The env file must hold the same DATABASE_URL and DATA_ENCRYPTION_KEY (or
// SESSION_SECRET) as the deployed app, or the app will not be able to read the result.
// Safe to run again: values that are already encrypted are skipped.
import process from "node:process";
import pg from "pg";
import { withVerifiedSsl } from "../src/lib/database-url.mjs";
import { isSealed, lookupToken, open, seal, sealJson } from "../src/lib/data-vault.ts";

const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) { console.error("DATABASE_URL must be configured."); process.exit(1); }
const pool = new pg.Pool({ connectionString: withVerifiedSsl(connectionString), max: 1 });
const client = await pool.connect();
const plainText = (value) => typeof value === "string" && value !== "" && !isSealed(value);
const plainJson = (value) => value && typeof value === "object" && !isSealed(value.enc);
let total = 0;
const report = (table, count) => { total += count; console.log(`${table}: ${count} row(s) ${apply ? "encrypted" : "to encrypt"}`); };

try {
  await client.query("BEGIN");

  // Safety check: values the deployed app has already encrypted must open with the key
  // in this env file. If they do not, this file holds a different key than the app, and
  // encrypting with it would leave the app unable to read anything this script touches.
  let sealedSeen = 0, sealedOpened = 0;
  const check = (userId, context, value) => { if (isSealed(value)) { sealedSeen++; if (open(userId, context, value) !== null) sealedOpened++; } };
  for (const row of (await client.query("SELECT user_id, gmail_message_id, analysis FROM message_insights")).rows) check(row.user_id, `message_insights.analysis:${row.gmail_message_id}`, row.analysis?.enc);
  for (const row of (await client.query("SELECT user_id, gmail_message_id, draft FROM reply_panel_states")).rows) check(row.user_id, `reply_panel_states.draft:${row.gmail_message_id}`, row.draft);
  for (const row of (await client.query("SELECT user_id, gmail_message_id, draft FROM reply_drafts")).rows) check(row.user_id, `reply_drafts.draft:${row.gmail_message_id}`, row.draft);
  const coreSeen = sealedSeen, coreOpened = sealedOpened;
  // Rows that can be written without the AI, so the key can be checked even when the model is unavailable.
  const tableExists = async (table) => (await client.query("SELECT to_regclass($1) AS name", [table])).rows[0].name !== null;
  for (const row of (await client.query("SELECT user_id, gmail_message_id, candidate_key, details FROM calendar_event_states")).rows) check(row.user_id, `calendar_event_states.details:${row.gmail_message_id}:${row.candidate_key}`, row.details?.enc);
  if (await tableExists("user_about")) {
    for (const row of (await client.query("SELECT user_id, role, organization, department, interests, notes FROM user_about")).rows) {
      for (const name of ["role", "organization", "department", "interests", "notes"]) check(row.user_id, `user_about.${name}`, row[name]);
    }
  }
  console.log(`Key check detail: drafts and AI readings ${coreOpened} of ${coreSeen}; event edits and About-you answers ${sealedOpened - coreOpened} of ${sealedSeen - coreSeen}.`);
  console.log(sealedSeen === 0
    ? "Key check: nothing is encrypted yet, so this key could not be compared with the deployed app's. Open one email in the deployed app first, then run this again."
    : `Key check: ${sealedOpened} of ${sealedSeen} value(s) already encrypted by the app open with this key.`);
  if (apply && !process.argv.includes("--force") && (sealedSeen === 0 || sealedOpened === 0)) {
    throw new Error(sealedSeen === 0 ? "Refusing to apply before the key has been checked against the deployed app (see above)." : "This env file's key does not match the deployed app's key.");
  }

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

  // --drop-unreadable: removes values that were encrypted with some other key (an earlier
  // server key, or a local dev server without the key). Nobody can read them any more, and
  // while they exist the app cannot store a fresh result in their place. The app then
  // regenerates what it needs. Only allowed when this key demonstrably matches the app's.
  if (process.argv.includes("--drop-unreadable")) {
    if (sealedOpened === 0) throw new Error("Refusing to drop anything: no value opens with this key, so this key is probably the wrong one.");
    const unreadable = (userId, context, value) => isSealed(value) && open(userId, context, value) === null;
    const targets = [
      ["message_insights", "SELECT user_id, gmail_message_id, analysis FROM message_insights", (row) => unreadable(row.user_id, `message_insights.analysis:${row.gmail_message_id}`, row.analysis?.enc),
        "DELETE FROM message_insights WHERE user_id = $1 AND gmail_message_id = $2", (row) => [row.user_id, row.gmail_message_id]],
      ["reply_panel_states", "SELECT user_id, gmail_message_id, draft FROM reply_panel_states", (row) => unreadable(row.user_id, `reply_panel_states.draft:${row.gmail_message_id}`, row.draft),
        "DELETE FROM reply_panel_states WHERE user_id = $1 AND gmail_message_id = $2", (row) => [row.user_id, row.gmail_message_id]],
      ["reply_drafts", "SELECT user_id, gmail_message_id, tone, length, instructions, draft FROM reply_drafts", (row) => unreadable(row.user_id, `reply_drafts.draft:${row.gmail_message_id}`, row.draft),
        "DELETE FROM reply_drafts WHERE user_id = $1 AND gmail_message_id = $2 AND tone = $3 AND length = $4 AND instructions = $5", (row) => [row.user_id, row.gmail_message_id, row.tone, row.length, row.instructions]],
    ];
    for (const [table, select, isUnreadable, remove, keyOf] of targets) {
      const rows = (await client.query(select)).rows.filter(isUnreadable);
      if (apply) for (const row of rows) await client.query(remove, keyOf(row));
      console.log(`${table}: ${rows.length} unreadable row(s) ${apply ? "removed" : "to remove"}`);
    }
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
