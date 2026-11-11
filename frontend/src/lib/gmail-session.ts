import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Credentials } from "google-auth-library";
import { query } from "./postgres";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function getKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be configured to encrypt OAuth tokens.");
  return createHash("sha256").update(secret).digest();
}

function sessionHash(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function sealGmailTokens(tokens: Credentials) {
  const { access_token, refresh_token, expiry_date, scope, token_type } = tokens;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ access_token, refresh_token, expiry_date, scope, token_type }), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openGmailTokens(sealed: string): Credentials | undefined {
  try {
    const data = Buffer.from(sealed, "base64url");
    if (data.length <= IV_LENGTH + TAG_LENGTH) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", getKey(), data.subarray(0, IV_LENGTH));
    decipher.setAuthTag(data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    const decrypted = Buffer.concat([
      decipher.update(data.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as Credentials;
  } catch {
    return undefined;
  }
}

export async function createGmailSession(tokens: Credentials) {
  const sessionId = randomBytes(32).toString("base64url");
  await query("DELETE FROM oauth_sessions WHERE expires_at <= NOW()");
  await query(`
    INSERT INTO oauth_sessions (session_hash, token_ciphertext, expires_at)
    VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
  `, [sessionHash(sessionId), sealGmailTokens(tokens), SESSION_TTL_SECONDS]);
  return sessionId;
}

export async function getGmailSession(sessionId: string): Promise<Credentials | undefined> {
  const result = await query<{ token_ciphertext: string }>(`
    UPDATE oauth_sessions
    SET last_seen_at = NOW()
    WHERE session_hash = $1 AND expires_at > NOW()
    RETURNING token_ciphertext
  `, [sessionHash(sessionId)]);
  const sealed = result.rows[0]?.token_ciphertext;
  return sealed ? openGmailTokens(sealed) : undefined;
}

/**
 * Same lookup as getGmailSession, but also returns the MailFlow user already
 * linked to this session so callers can skip the Gmail profile round trip.
 */
export async function getGmailSessionWithUser(sessionId: string): Promise<{ tokens: Credentials; userId: number | null } | undefined> {
  const result = await query<{ token_ciphertext: string; user_id: number | null }>(`
    UPDATE oauth_sessions
    SET last_seen_at = NOW()
    WHERE session_hash = $1 AND expires_at > NOW()
    RETURNING token_ciphertext, user_id
  `, [sessionHash(sessionId)]);
  const row = result.rows[0];
  const tokens = row ? openGmailTokens(row.token_ciphertext) : undefined;
  return tokens ? { tokens, userId: row.user_id ?? null } : undefined;
}

export async function attachGmailSessionToUser(sessionId: string, userId: number) {
  await query(`
    UPDATE oauth_sessions
    SET user_id = $2, last_seen_at = NOW()
    WHERE session_hash = $1 AND expires_at > NOW()
  `, [sessionHash(sessionId), userId]);
}
