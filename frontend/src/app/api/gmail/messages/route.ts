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
    const afterParam = request.nextUrl.searchParams.get("after");
    const after = afterParam ? Number(afterParam) : Number.NaN;
    const afterSeconds = Number.isFinite(after) && after > 0
      ? Math.floor(after / 1000)
      : undefined;
    const requestedMode = request.nextUrl.searchParams.get("mode");
    const mailboxMode = requestedMode === "starred" || requestedMode === "drafts" || requestedMode === "trash"
      ? requestedMode
      : "all";
    const requestedPageToken = request.nextUrl.searchParams.get("pageToken") ?? undefined;

    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);
    oauth2Client.on("tokens", (newTokens) => {
      saveGmailSession(sessionId, { ...tokens, ...newTokens });
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const messageIds: string[] = [];
    let pageToken = requestedPageToken;
    let nextPageToken: string | undefined;
    let resultSizeEstimate: number | undefined;
    const isDailyBriefing = Boolean(afterSeconds);
    const labelIds = isDailyBriefing
      ? ["INBOX"]
      : mailboxMode === "starred"
        ? ["STARRED"]
        : mailboxMode === "drafts"
          ? ["DRAFT"]
        : mailboxMode === "trash"
          ? ["TRASH"]
          : undefined;

    do {
      const list = await gmail.users.messages.list({
        userId: "me",
        labelIds,
        includeSpamTrash: mailboxMode === "trash",
        maxResults: isDailyBriefing ? 100 : 50,
        pageToken,
        q: afterSeconds ? `after:${afterSeconds}` : undefined,
      });

      messageIds.push(
        ...(list.data.messages ?? []).flatMap(({ id }) => (id ? [id] : [])),
      );
      nextPageToken = list.data.nextPageToken ?? undefined;
      resultSizeEstimate = list.data.resultSizeEstimate ?? undefined;
      pageToken = isDailyBriefing ? nextPageToken : undefined;
    } while (isDailyBriefing && pageToken);

    const messages = await Promise.all(
      messageIds.map(async (id) => {
        const result = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        const message = parseGmailMessage(result.data);
        const receivedAt = Number(result.data.internalDate ?? 0);
        return !afterSeconds || receivedAt >= afterSeconds * 1000 ? message : null;
      }),
    );

    const filteredMessages = messages.filter((message) => message !== null);

    return NextResponse.json({
      connected: true,
      messages: isDailyBriefing
        ? filteredMessages.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
        : filteredMessages,
      nextPageToken: !isDailyBriefing ? nextPageToken : undefined,
      resultSizeEstimate: !isDailyBriefing ? resultSizeEstimate : undefined,
    });
  } catch (gmailError) {
    console.error("Gmail API request failed", gmailError);
    return NextResponse.json(
      { error: "gmail_request_failed" },
      { status: 502 },
    );
  }
}

