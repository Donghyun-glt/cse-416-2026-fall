// Field-level encryption for what MailFlow stores about a user.
//
// Threat model: someone who can read the database (a developer with the
// connection string, the hosting console, a leaked backup) must not be able to
// read users' content. So content is encrypted in the application before it is
// written, with a key that is never in the database:
//   master key  = DATA_ENCRYPTION_KEY (server environment only)
//   user key    = HKDF(master key, user id)   -> one user's key opens nobody else's rows
//   each value  = AES-256-GCM, bound to its table/column/row ("context"), so a
//                 ciphertext copied into another row or column does not decrypt.
// What this cannot stop: someone who holds the server key as well, or who can
// deploy server code. No I/O here, so it can be unit-tested and used by scripts.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function masterKey() {
  const secret = process.env.DATA_ENCRYPTION_KEY?.trim() || process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("DATA_ENCRYPTION_KEY must be configured to store user data.");
  return createHash("sha256").update(`mailflow-data\0${secret}`).digest();
}
const userKeys = new Map<string, Buffer>();
function userKey(userId: number) {
  const master = masterKey();
  const cacheKey = `${master.toString("hex")}:${userId}`;
  let key = userKeys.get(cacheKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `mailflow:user:${userId}`, 32));
    if (userKeys.size > 500) userKeys.clear();
    userKeys.set(cacheKey, key);
  }
  return key;
}

export const isSealed = (value: unknown): value is string => typeof value === "string" && value.startsWith(PREFIX);

/** Encrypts one value for one user. `context` names where it is stored, e.g. "todo_items.task:<message id>". */
export function seal(userId: number, context: string, plaintext: string) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", userKey(userId), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

/**
 * Decrypts a stored value. Rows written before encryption was introduced are plain
 * text and are returned as they are. Returns null when the value cannot be opened
 * (wrong user, moved to another row, tampered, or the key changed).
 */
export function open(userId: number, context: string, stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (!isSealed(stored)) return stored;
  try {
    const data = Buffer.from(stored.slice(PREFIX.length), "base64url");
    if (data.length < IV_LENGTH + TAG_LENGTH) return null;
    const decipher = createDecipheriv("aes-256-gcm", userKey(userId), data.subarray(0, IV_LENGTH));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    return Buffer.concat([decipher.update(data.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString("utf8");
  } catch { return null; }
}

/** For JSONB columns: the whole value becomes {"enc": "..."} so nothing inside it is readable or queryable. */
export function sealJson(userId: number, context: string, value: unknown) {
  return JSON.stringify({ enc: seal(userId, context, JSON.stringify(value)) });
}
export function openJson(userId: number, context: string, stored: unknown): unknown | null {
  if (stored === null || stored === undefined) return null;
  const sealed = (stored as { enc?: unknown }).enc;
  if (!isSealed(sealed)) return stored; // Written before encryption was introduced.
  const text = open(userId, context, sealed);
  if (text === null) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

/**
 * A stable stand-in for a value that must be matched in SQL (part of a key) but must
 * not be readable: the same input always gives the same token for the same user.
 */
export function lookupToken(userId: number, context: string, value: string) {
  return value === "" ? "" : `h:v1:${createHmac("sha256", userKey(userId)).update(`${context}\0${value}`).digest("base64url")}`;
}
