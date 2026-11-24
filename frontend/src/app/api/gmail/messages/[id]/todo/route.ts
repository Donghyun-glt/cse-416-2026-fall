import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSessionWithUser } from "@/lib/gmail-session";
import { generateText } from "@/lib/gemini";
import { decideFeedback, feedbackPrompt, feedbackSchema } from "@/lib/summary-todo";
import { answerTodoAudience, getTodoItem, getTodoTriage, getUserAbout, listSummaryAnswers, resolveTodoReason, saveSummaryAnswer, setTodoStatus, upsertUser } from "@/lib/mailflow-db";

/**
 * After an "Is this for you?" answer: decide whether it is worth remembering for the same
 * audience or kind of mail, and store it if so. Usually nothing is stored. This never
 * reads the email again and never writes the user's About-you details.
 */
async function rememberAnswer(userId: number, gmailMessageId: string, forMe: boolean) {
  const triage = await getTodoTriage(userId, gmailMessageId);
  if (!triage) return;
  const [about, answers] = await Promise.all([getUserAbout(userId), listSummaryAnswers(userId)]);
  const input = { answer: forMe ? "yes" as const : "no" as const, triage, about, answers };
  const response = await generateText(feedbackPrompt(input), { temperature: 0, maxOutputTokens: 400, responseJsonSchema: feedbackSchema, signal: AbortSignal.timeout(15000) });
  const note = decideFeedback(JSON.parse(response), input);
  if (note) await saveSummaryAnswer(userId, note);
}

/**
 * PUT /api/gmail/messages/[id]/todo
 * The user's own handling of a Summary item. Body is one of:
 *   { status: "open" | "done" | "not_relevant", today?: "YYYY-MM-DD" }  mark it (open also adds a message by hand;
 *                                                  today is the user's calendar day, used when reopening)
 *   { resolved: "reply" }                          the reply was sent; done if nothing else is left
 *   { forMe: boolean }                             answer to "Is this for you?": true keeps it, false removes it
 * Returns: { todo } as it now stands. Scoped to the signed-in user.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!sessionId || !session) return NextResponse.json({ connected: false }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { status?: unknown; resolved?: unknown; forMe?: unknown; today?: unknown } | null;
  const status = body?.status;
  const validStatus = status === "open" || status === "done" || status === "not_relevant";
  const forMe = typeof body?.forMe === "boolean" ? body.forMe : undefined;
  const today = typeof body?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) && Number.isFinite(Date.parse(body.today)) ? body.today : undefined;
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || (!validStatus && forMe === undefined && body?.resolved !== "reply")) return NextResponse.json({ error: "invalid_todo" }, { status: 400 });
  try {
    let userId = session.userId;
    if (userId === null) {
      const auth = createGoogleOAuthClient(); auth.setCredentials(session.tokens);
      const profile = await google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
      userId = await upsertUser(profile.data.emailAddress ?? "");
      await attachGmailSessionToUser(sessionId, userId);
    }
    if (validStatus) await setTodoStatus(userId, id, status, today);
    else if (forMe !== undefined) {
      // The answer itself always stands; remembering it is best effort.
      if (await answerTodoAudience(userId, id, forMe)) await rememberAnswer(userId, id, forMe).catch(() => { console.error("Summary answer could not be remembered"); });
    } else await resolveTodoReason(userId, id, "reply");
    return NextResponse.json({ todo: await getTodoItem(userId, id) });
  } catch (error) {
    console.error("Summary to-do could not be updated", error);
    return NextResponse.json({ error: "todo_failed" }, { status: 502 });
  }
}
