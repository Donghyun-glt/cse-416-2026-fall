import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient, GMAIL_MODIFY_SCOPE } from "@/lib/google";
import { getGmailSession } from "@/lib/gmail-session";
import { upsertUser } from "@/lib/mailflow-db";

function fallbackName(email: string) {
  return email.split("@")[0] || "Gmail user";
}

function getHttpStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; response?: { status?: unknown } };
  if (typeof value.response?.status === "number") return value.response.status;
  return typeof value.code === "number" ? value.code : undefined;
}

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? getGmailSession(sessionId) : undefined;

  if (!sessionId || !tokens) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }

  try {
    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const gmailProfile = await gmail.users.getProfile({ userId: "me" });
    const email = gmailProfile.data.emailAddress ?? "";
    let name = "";
    let requiresProfileAuthorization = false;
    let grantedScopes = tokens.scope?.split(" ").filter(Boolean) ?? [];

    if (grantedScopes.length === 0 && tokens.access_token) {
      try {
        const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token);
        grantedScopes = tokenInfo.scopes;
      } catch {
        // A later Gmail mutation will still return a clear permission error if
        // this older token cannot be inspected.
      }
    }

    try {
      const oauth = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfo = await oauth.userinfo.get();
      name = userInfo.data.name?.trim() ?? "";
    } catch (profileScopeError) {
      // Sessions created before profile scope was added can still use Gmail's
      // email address and receive a stable local-part fallback name.
      const status = getHttpStatus(profileScopeError);
      requiresProfileAuthorization = status === 401 || status === 403;
    }

    const displayName = name || fallbackName(email);
    upsertUser(email, displayName);

    return NextResponse.json({
      connected: true,
      name: displayName,
      email,
      requiresProfileAuthorization,
      requiresMailboxAuthorization:
        grantedScopes.length > 0 && !grantedScopes.includes(GMAIL_MODIFY_SCOPE),
    });
  } catch (profileError) {
    console.error("Google profile request failed", profileError);
    return NextResponse.json({ error: "profile_request_failed" }, { status: 502 });
  }
}
