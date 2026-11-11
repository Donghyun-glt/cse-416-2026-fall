import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSessionWithUser } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";
import { getOrAssignPriorities } from "@/lib/gmail-priority";
import { upsertUser } from "@/lib/mailflow-db";
import { comparePriority } from "@/lib/mail-priority";

// Lists only need what a row shows. Bodies and attachments are fetched by
// GET /api/gmail/messages/[id] when the user opens a message.
const LIST_HEADERS = ["Subject", "From", "To", "Cc", "Date", "List-Unsubscribe"];

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  const tokens = session?.tokens;

  if (!sessionId || !session || !tokens) {
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
    // Optional mailbox filters, applied by Gmail's own search.
    const onlyAttachments = request.nextUrl.searchParams.get("attachment") === "1";
    const onlyUnread = request.nextUrl.searchParams.get("unread") === "1";
    const requestedPageToken = request.nextUrl.searchParams.get("pageToken") ?? undefined;

    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const isDailyBriefing = Boolean(afterSeconds);
    // The session already knows its user after the first request, so the Gmail
    // profile call and the user upsert only run once per login.
    let userId = session.userId;
    if (userId === null) {
      const gmailProfile = await gmail.users.getProfile({ userId: "me" });
      userId = await upsertUser(gmailProfile.data.emailAddress ?? "");
      await attachGmailSessionToUser(sessionId, userId);
    }

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
        q: [
          afterSeconds ? `after:${afterSeconds}` : "",
          excludeSent ? "-in:sent" : "",
          !isDailyBriefing && onlyAttachments ? "has:attachment" : "",
          !isDailyBriefing && onlyUnread ? "is:unread" : "",
        ].filter(Boolean).join(" ") || undefined,
      });

      messageIds.push(
        ...(list.data.messages ?? []).flatMap(({ id }) => (id ? [id] : [])),
      );
      nextPageToken = list.data.nextPageToken ?? undefined;
      resultSizeEstimate = list.data.resultSizeEstimate ?? undefined;
      pageToken = isDailyBriefing ? nextPageToken : undefined;
    } while (isDailyBriefing && pageToken);

    const fetched = await Promise.all(
      messageIds.map(async (id) => (await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: LIST_HEADERS,
      })).data),
    );
    const priorities = await getOrAssignPriorities(
      fetched.filter((message) => !message.labelIds?.includes("DRAFT")),
      userId,
    );

    const filteredMessages = fetched.flatMap((data) => {
      const receivedAt = Number(data.internalDate ?? 0);
      if (afterSeconds && receivedAt < afterSeconds * 1000) return [];
      const priority = priorities.get(data.id ?? "") ?? "fyi";
      // partial: the body has not been loaded yet (html is empty on purpose).
      return [{ ...parseGmailMessage(data), html: "", priority, partial: true }];
    });

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

