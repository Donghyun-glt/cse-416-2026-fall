import { after, type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession, saveGmailSession } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";
import { ensurePriorityLabels, getOrAssignPriority } from "@/lib/gmail-priority";
import { getPriorityIndex, getReadyPriorityIndex, priorityIndexNeedsRefresh } from "@/lib/priority-index";
import { classifyPriority, comparePriority, priorityFromLabels } from "@/lib/mail-priority";

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? getGmailSession(sessionId) : undefined;

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
    const isDailyBriefing = Boolean(afterSeconds);
    const labels = await ensurePriorityLabels(gmail);

    if (!isDailyBriefing && mailboxMode === "all") {
      const requestedPage = Number(request.nextUrl.searchParams.get("page"));
      const page = Number.isSafeInteger(requestedPage) && requestedPage >= 0 ? requestedPage : 0;
      const index = getReadyPriorityIndex(sessionId);
      if (index) {
        if (priorityIndexNeedsRefresh(sessionId)) {
          after(async () => {
            try { await getPriorityIndex(sessionId, gmail); }
            catch (error) { console.error("Gmail priority indexing failed", error); }
          });
        }
        const selected = index.slice(page * 50, (page + 1) * 50);
        const messages = await Promise.all(selected.map(async ({ id, priority }) => {
          const result = await gmail.users.messages.get({ userId: "me", id, format: "full" });
          return { ...parseGmailMessage(result.data), priority };
        }));
        return NextResponse.json({ connected: true, messages, nextPageToken: (page + 1) * 50 < index.length ? String(page + 1) : undefined, resultSizeEstimate: index.length, sortingPending: false });
      }

      // Serve the requested Gmail page immediately. The complete priority index
      // is built after this response so large mailboxes cannot hold the UI open.
      const list = await gmail.users.messages.list({ userId: "me", maxResults: 50, pageToken: requestedPageToken });
      const messages = await Promise.all((list.data.messages ?? []).flatMap(({ id }) => id ? [id] : []).map(async (id) => {
        const result = await gmail.users.messages.get({ userId: "me", id, format: "full" });
        if (result.data.labelIds?.includes("DRAFT")) return null;
        const priority = priorityFromLabels(result.data.labelIds, labels) ?? classifyPriority(result.data);
        return { ...parseGmailMessage(result.data), priority };
      }));
      after(async () => {
        try {
          await getPriorityIndex(sessionId, gmail);
        } catch (error) {
          console.error("Gmail priority indexing failed", error);
        }
      });
      return NextResponse.json({
        connected: true,
        messages: messages.filter((message) => message !== null).sort(comparePriority),
        nextPageToken: list.data.nextPageToken ?? undefined,
        resultSizeEstimate: list.data.resultSizeEstimate ?? undefined,
        sortingPending: true,
      });
    }

    const messageIds: string[] = [];
    let pageToken = requestedPageToken;
    let nextPageToken: string | undefined;
    let resultSizeEstimate: number | undefined;
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
        const priority = result.data.labelIds?.includes("DRAFT") ? "fyi" : await getOrAssignPriority(gmail, result.data, labels);
        const message = { ...parseGmailMessage(result.data), priority };
        const receivedAt = Number(result.data.internalDate ?? 0);
        return !afterSeconds || receivedAt >= afterSeconds * 1000 ? message : null;
      }),
    );

    const filteredMessages = messages.filter((message) => message !== null);

    return NextResponse.json({
      connected: true,
      messages: filteredMessages.sort(comparePriority),
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

