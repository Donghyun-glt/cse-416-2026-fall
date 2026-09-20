import type { Credentials } from "google-auth-library";

type SessionStore = Map<string, Credentials>;

const globalWithGmailSessions = globalThis as typeof globalThis & {
  gmailSessions?: SessionStore;
};

const sessions =
  globalWithGmailSessions.gmailSessions ??
  (globalWithGmailSessions.gmailSessions = new Map<string, Credentials>());

export function saveGmailSession(sessionId: string, tokens: Credentials) {
  sessions.set(sessionId, tokens);
}

export function getGmailSession(sessionId: string) {
  return sessions.get(sessionId);
}

export function deleteGmailSession(sessionId: string) {
  sessions.delete(sessionId);
}

