import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Credentials } from "google-auth-library";
import { query } from "./postgres";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// With a session id the key also depends on the session cookie, which the database
// never holds (it stores only a hash of it). Stored tokens then cannot be decrypted
// from the database and the server secret alone: the user's own cookie is needed too.
function getKey(sessionId?: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be configured to encrypt OAuth tokens.");
  return createHash("sha256").update(sessionId ? `${secret}\0session\0${sessionId}` : secret).digest();
}

function sessionHash(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

export function sealGmailTokens(tokens: Credentials, sessionId?: string) {
  const { access_token, refresh_token, expiry_date, scope, token_type } = tokens;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(sessionId), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ access_token, refresh_token, expiry_date, scope, token_type }), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function openWith(key: Buffer, sealed: string): Credentials | undefined {
  try {
    const data = Buffer.from(sealed, "base64url");
    if (data.length <= IV_LENGTH + TAG_LENGTH) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, IV_LENGTH));
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

export function openGmailTokens(sealed: string, sessionId?: string): Credentials | undefined {
  // Sessions created before tokens were bound to the cookie still open with the
  // server secret alone until they expire (at most 7 days).
  return (sessionId ? openWith(getKey(sessionId), sealed) : undefined) ?? openWith(getKey(), sealed);
}

export async function createGmailSession(tokens: Credentials) {
  const sessionId = randomBytes(32).toString("base64url");
  await query("DELETE FROM oauth_sessions WHERE expires_at <= NOW()");
  await query(`
    INSERT INTO oauth_sessions (session_hash, token_ciphertext, expires_at)
    VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
  `, [sessionHash(sessionId), sealGmailTokens(tokens, sessionId), SESSION_TTL_SECONDS]);
  return sessionId;
}

// ----- Session lookups -----
// Every API request starts by finding its session. Reading it from the database each time
// costs one round trip per request (about 0.2 s from a distant database), so a session that
// was just read is kept in this server's memory for a minute and reused. Only sessions that
// exist are kept. Logging out removes the entry at once on the server that handles the
// logout; another server instance can keep using its copy for at most SESSION_CACHE_MS.
const SESSION_CACHE_MS = 60_000;
const SESSION_CACHE_LIMIT = 500;

type CachedSession = { tokens: Credentials; userId: number | null; until: number };
type SessionCache = {
  entries: Map<string, CachedSession>;
  /** Lookups in flight: requests arriving together share one database query. */
  pending: Map<string, Promise<CachedSession | undefined>>;
  /** Sessions deleted here, so a lookup that was already running cannot cache them again. */
  revoked: Set<string>;
};
// Kept on globalThis so development hot reloads do not start an empty cache each time.
const globalWithSessions = globalThis as typeof globalThis & { mailflowSessionCache?: SessionCache };
const sessionCache = globalWithSessions.mailflowSessionCache
  ?? (globalWithSessions.mailflowSessionCache = { entries: new Map(), pending: new Map(), revoked: new Set() });

async function lookupSession(sessionId: string): Promise<CachedSession | undefined> {
  const hash = sessionHash(sessionId);
  const cached = sessionCache.entries.get(hash);
  if (cached && cached.until > Date.now()) return cached;
  if (cached) sessionCache.entries.delete(hash);
  const inFlight = sessionCache.pending.get(hash);
  if (inFlight) return inFlight;

  const work = (async () => {
    // last_seen_at is therefore written at most about once a minute per session.
    const result = await query<{ token_ciphertext: string; user_id: number | null; expires_at: Date | string }>(`
      UPDATE oauth_sessions
      SET last_seen_at = NOW()
      WHERE session_hash = $1 AND expires_at > NOW()
      RETURNING token_ciphertext, user_id, expires_at
    `, [hash]);
    const row = result.rows[0];
    const tokens = row ? openGmailTokens(row.token_ciphertext, sessionId) : undefined;
    if (!row || !tokens) return undefined;
    const expiresAt = new Date(row.expires_at).getTime();
    // Never kept past the session's own expiry.
    const entry: CachedSession = { tokens, userId: row.user_id ?? null, until: Math.min(Date.now() + SESSION_CACHE_MS, Number.isFinite(expiresAt) ? expiresAt : 0) };
    if (!sessionCache.revoked.has(hash)) {
      if (sessionCache.entries.size >= SESSION_CACHE_LIMIT) sessionCache.entries.delete(sessionCache.entries.keys().next().value!);
      sessionCache.entries.set(hash, entry);
    }
    return entry;
  })();
  sessionCache.pending.set(hash, work);
  try { return await work; } finally { sessionCache.pending.delete(hash); }
}

export async function deleteGmailSession(sessionId: string) {
  const hash = sessionHash(sessionId);
  await query("DELETE FROM oauth_sessions WHERE session_hash = $1", [hash]);
  sessionCache.entries.delete(hash);
  if (sessionCache.revoked.size >= SESSION_CACHE_LIMIT) sessionCache.revoked.delete(sessionCache.revoked.values().next().value!);
  sessionCache.revoked.add(hash);
}

export async function getGmailSession(sessionId: string): Promise<Credentials | undefined> {
  const session = await lookupSession(sessionId);
  // A copy per request: the Google client may replace fields on the object it is given.
  return session ? { ...session.tokens } : undefined;
}

/**
 * Same lookup as getGmailSession, but also returns the MailFlow user already
 * linked to this session so callers can skip the Gmail profile round trip.
 */
export async function getGmailSessionWithUser(sessionId: string): Promise<{ tokens: Credentials; userId: number | null } | undefined> {
  const session = await lookupSession(sessionId);
  return session ? { tokens: { ...session.tokens }, userId: session.userId } : undefined;
}

export async function attachGmailSessionToUser(sessionId: string, userId: number) {
  await query(`
    UPDATE oauth_sessions
    SET user_id = $2, last_seen_at = NOW()
    WHERE session_hash = $1 AND expires_at > NOW()
  `, [sessionHash(sessionId), userId]);
  const cached = sessionCache.entries.get(sessionHash(sessionId));
  if (cached) cached.userId = userId;
}
