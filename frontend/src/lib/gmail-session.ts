import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Credentials } from "google-auth-library";

// Serverless hosts such as Vercel do not share memory between requests, so the
// session lives in the browser as an encrypted, HttpOnly cookie instead of in a
// server-side map. Only the server holds the key, so the browser can neither
// read nor forge the Google tokens inside.
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  // SESSION_SECRET is preferred; the OAuth client secret is already a
  // server-only value, so it is a safe fallback for local development.
  const secret = process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("SESSION_SECRET or GOOGLE_CLIENT_SECRET must be configured.");
  return createHash("sha256").update(secret).digest();
}

export function sealGmailSession(tokens: Credentials) {
  // The ID token is not needed after login and would make the cookie too large.
  const { access_token, refresh_token, expiry_date, scope, token_type } = tokens;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ access_token, refresh_token, expiry_date, scope, token_type }), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function getGmailSession(sealed: string): Credentials | undefined {
  try {
    const data = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", getKey(), data.subarray(0, IV_LENGTH));
    decipher.setAuthTag(data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    const decrypted = Buffer.concat([
      decipher.update(data.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as Credentials;
  } catch {
    // Tampered, truncated, or encrypted with an old key: treat as logged out.
    return undefined;
  }
}
