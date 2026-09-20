import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession, saveGmailSession } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? getGmailSession(sessionId) : undefined;

  if (!sessionId || !tokens) {
    return NextResponse.json({ connected: false, messages: [] }, { status: 401 });
  }

  try {
    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);
    oauth2Client.on("tokens", (newTokens) => {
      saveGmailSession(sessionId, { ...tokens, ...newTokens });
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const list = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      maxResults: 10,
    });

    const messages = await Promise.all(
      (list.data.messages ?? []).map(async ({ id }) => {
        if (!id) return null;
        const result = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        return parseGmailMessage(result.data);
      }),
    );

    return NextResponse.json({
      connected: true,
      messages: messages.filter((message) => message !== null),
    });
  } catch (gmailError) {
    console.error("Gmail API request failed", gmailError);
    return NextResponse.json(
      { error: "gmail_request_failed" },
      { status: 502 },
    );
  }
}

