import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient, GMAIL_MODIFY_SCOPE } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSession } from "@/lib/gmail-session";
import { upsertUser } from "@/lib/mailflow-db";

function fallbackName(email: string) {
  return email.split("@")[0] || "Gmail user";
}

/**
 * The photo the user set on their Google account, from the "profile" scope MailFlow already
 * asks for. Only Google's own image host is accepted, and it is asked for at 192 px so the
 * avatar stays sharp on high-density screens. Nothing is stored: the browser loads it directly.
 */
function profilePicture(value: string | null | undefined) {
  if (!value || !/^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(value)) return "";
  return value.replace(/=s\d+(-c)?$/, "=s192-c");
}

function getHttpStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; response?: { status?: unknown } };
  if (typeof value.response?.status === "number") return value.response.status;
  return typeof value.code === "number" ? value.code : undefined;
}

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;

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
    let picture = "";
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
      picture = profilePicture(userInfo.data.picture);
    } catch (profileScopeError) {
      // Sessions created before profile scope was added can still use Gmail's
      // email address and receive a stable local-part fallback name.
      const status = getHttpStatus(profileScopeError);
      requiresProfileAuthorization = status === 401 || status === 403;
    }

    const displayName = name || fallbackName(email);
    const userId = await upsertUser(email, displayName);
    await attachGmailSessionToUser(sessionId, userId);

    return NextResponse.json({
      connected: true,
      name: displayName,
      email,
      picture,
      requiresProfileAuthorization,
      requiresMailboxAuthorization:
        grantedScopes.length > 0 && !grantedScopes.includes(GMAIL_MODIFY_SCOPE),
    });
  } catch (profileError) {
    console.error("Google profile request failed", profileError);
    return NextResponse.json({ error: "profile_request_failed" }, { status: 502 });
  }
}
