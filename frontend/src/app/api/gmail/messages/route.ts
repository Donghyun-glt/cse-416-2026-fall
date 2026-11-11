import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSession } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";
import { getOrAssignPriority } from "@/lib/gmail-priority";
import { upsertUser } from "@/lib/mailflow-db";
import { comparePriority } from "@/lib/mail-priority";

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;

  if (!sessionId || !tokens) {
    return NextResponse.json({ connected: false, messages: [] }, { status: 401 });
  }

  try {
    const afterParam = request.nextUrl.searchParams.get("after");
    const afterTimestamp = afterParam ? Number(afterParam) : Number.NaN;
    const afterSeconds = Number.isFinite(afterTimestamp) && afterTimestamp > 0
      ? Math.floor(afterTimestamp / 1000)
      : undefined;
    const requestedMode = request.nextUrl.searchParams.get("mode");
    const mailboxMode = requestedMode === "inbox" || requestedMode === "starred" || requestedMode === "drafts" || requestedMode === "trash" || requestedMode === "sent" || requestedMode === "spam"
      ? requestedMode
      : "all";
    const requestedPageToken = request.nextUrl.searchParams.get("pageToken") ?? undefined;

    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const isDailyBriefing = Boolean(afterSeconds);
    const gmailProfile = await gmail.users.getProfile({ userId: "me" });
    const userId = await upsertUser(gmailProfile.data.emailAddress ?? "");
    await attachGmailSessionToUser(sessionId, userId);

    const messageIds: string[] = [];
    let pageToken = requestedPageToken;
    let nextPageToken: string | undefined;
    let resultSizeEstimate: number | undefined;
    const labelIds = isDailyBriefing
      ? ["INBOX"]
      : mailboxMode === "inbox"
        ? ["INBOX"]
      : mailboxMode === "spam"
        ? ["SPAM"]
      : mailboxMode === "starred"
        ? ["STARRED"]
        : mailboxMode === "drafts"
          ? ["DRAFT"]
        : mailboxMode === "trash"
          ? ["TRASH"]
        : mailboxMode === "sent"
          ? ["SENT"]
          : undefined;
    // Like Gmail: "Inbox" is only mail that still carries the INBOX label, so
    // archiving a message removes it from that view. "All Emails" is everything
    // you received (inbox + archived); mail you sent has its own Sent view.
    // Spam and Trash are only listed in their own views.
    const excludeSent = !isDailyBriefing && mailboxMode === "all";

    do {
      const list = await gmail.users.messages.list({
        userId: "me",
        labelIds,
        includeSpamTrash: mailboxMode === "trash" || mailboxMode === "spam",
        maxResults: isDailyBriefing ? 100 : 50,
        pageToken,
        q: [afterSeconds ? `after:${afterSeconds}` : "", excludeSent ? "-in:sent" : ""].filter(Boolean).join(" ") || undefined,
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
        const priority = result.data.labelIds?.includes("DRAFT") ? "fyi" : await getOrAssignPriority(result.data, userId);
        const message = { ...parseGmailMessage(result.data), priority };
        const receivedAt = Number(result.data.internalDate ?? 0);
        return !afterSeconds || receivedAt >= afterSeconds * 1000 ? message : null;
      }),
    );

    const filteredMessages = messages.filter((message) => message !== null);

    return NextResponse.json({
      connected: true,
      // Gmail already returns ordinary mailbox pages in its native incoming-mail
      // order. Only the Daily Briefing groups messages by MailFlow priority.
      messages: isDailyBriefing ? filteredMessages.sort(comparePriority) : filteredMessages,
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

