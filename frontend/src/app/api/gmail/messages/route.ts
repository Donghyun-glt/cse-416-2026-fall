import { type NextRequest, NextResponse } from "next/server";
import { google, type gmail_v1 } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSessionWithUser } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";
import { getOrAssignPriorities } from "@/lib/gmail-priority";
import { getAnalysedMessageIds, getInsightSummaries, getStoredPriorities, listTodoItems, upsertUser } from "@/lib/mailflow-db";
import { comparePriority } from "@/lib/mail-priority";

// Lists only need what a row shows. Bodies and attachments are fetched by
// GET /api/gmail/messages/[id] when the user opens a message.
const LIST_HEADERS = ["Subject", "From", "To", "Cc", "Date", "List-Unsubscribe"];
const SUMMARY_DISCOVERY_SIZE = 50;
const SUMMARY_METADATA_CONCURRENCY = 10;

async function getMetadata(gmail: gmail_v1.Gmail, id: string) {
  const { data } = await gmail.users.messages.get({
    userId: "me", id, format: "metadata", metadataHeaders: LIST_HEADERS,
  });
  return data;
}

function isReceivedMessage(data: gmail_v1.Schema$Message) {
  return !data.labelIds?.some((label) => ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label));
}

async function getSummaryMetadata(gmail: gmail_v1.Gmail, ids: string[]) {
  const messages = new Map<string, gmail_v1.Schema$Message>();
  for (let offset = 0; offset < ids.length; offset += SUMMARY_METADATA_CONCURRENCY) {
    await Promise.all(ids.slice(offset, offset + SUMMARY_METADATA_CONCURRENCY).map(async (id) => {
      try {
        messages.set(id, await getMetadata(gmail, id));
      } catch (error) {
        // A permanently deleted message can still have a stored priority.
        if ((error as { code?: unknown })?.code !== 404) throw error;
      }
    }));
  }
  return messages;
}

const SUMMARY_PENDING_LIMIT = 20;

/**
 * Summary tab: the messages that still need something from the user (todo_items),
 * whatever their priority label, plus the ids of recent mail that has not been
 * analysed yet so the client can have it analysed even when Summary is the only
 * view the user opens.
 */
async function loadSummary(gmail: gmail_v1.Gmail, userId: number) {
  const { data } = await gmail.users.messages.list({ userId: "me", maxResults: SUMMARY_DISCOVERY_SIZE, q: "newer_than:14d -in:sent -in:drafts -in:spam -in:trash" });
  const recentIds = (data.messages ?? []).flatMap(({ id }) => id ? [id] : []);
  const [storedPriorities, analysed, items] = await Promise.all([getStoredPriorities(userId, recentIds), getAnalysedMessageIds(userId, recentIds), listTodoItems(userId)]);
  // New mail still gets its provisional priority label, as in every other list.
  const unlabelled = await getSummaryMetadata(gmail, recentIds.filter((id) => !storedPriorities.has(id)));
  await getOrAssignPriorities([...unlabelled.values()].filter(isReceivedMessage), userId);

  const itemIds = items.map((item) => item.gmailMessageId);
  const [metadata, priorities, summaries] = await Promise.all([
    getSummaryMetadata(gmail, itemIds.filter((id) => !unlabelled.has(id))), getStoredPriorities(userId, itemIds), getInsightSummaries(userId, itemIds),
  ]);
  const messages = items.flatMap((item) => {
    const message = unlabelled.get(item.gmailMessageId) ?? metadata.get(item.gmailMessageId);
    // Deleted, trashed or spam-filed mail needs nothing more from the user.
    if (!message || !isReceivedMessage(message)) return [];
    return [{
      ...parseGmailMessage(message), html: "", partial: true,
      priority: priorities.get(item.gmailMessageId) ?? "fyi",
      summary: summaries.get(item.gmailMessageId),
      todo: { task: item.task, dueDate: item.dueDate, reasons: item.reasons, confirmAudience: item.confirmAudience, status: item.status },
    }];
  });
  return { messages, pending: recentIds.filter((id) => !analysed.has(id)).slice(0, SUMMARY_PENDING_LIMIT) };
}

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

    if (requestedMode === "summary") {
      return NextResponse.json({ connected: true, ...await loadSummary(gmail, userId) });
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

    // Threads that contain an unfinished reply get a "Draft" marker in the
    // list, like Gmail. A failure here only hides the marker.
    const draftThreadsPromise = gmail.users.drafts.list({ userId: "me", maxResults: 100 })
      .then((result) => new Set((result.data.drafts ?? []).flatMap((draft) => (draft.message?.threadId ? [draft.message.threadId] : []))))
      .catch(() => new Set<string>());

    const fetched = await Promise.all(messageIds.map((id) => getMetadata(gmail, id)));
    const priorities = await getOrAssignPriorities(
      fetched.filter((message) => !message.labelIds?.includes("DRAFT")),
      userId,
    );

    const draftThreads = await draftThreadsPromise;

    const filteredMessages = fetched.flatMap((data) => {
      const receivedAt = Number(data.internalDate ?? 0);
      if (afterSeconds && receivedAt < afterSeconds * 1000) return [];
      const priority = priorities.get(data.id ?? "") ?? "fyi";
      // partial: the body has not been loaded yet (html is empty on purpose).
      const hasDraft = !data.labelIds?.includes("DRAFT") && draftThreads.has(data.threadId ?? "");
      return [{ ...parseGmailMessage(data), html: "", priority, partial: true, hasDraft }];
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

