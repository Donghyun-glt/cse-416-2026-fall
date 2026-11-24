import { type NextRequest, NextResponse } from "next/server";
import { getGmailSessionWithUser } from "@/lib/gmail-session";
import { deleteSummaryAnswers, listSummaryAnswers } from "@/lib/mailflow-db";

/**
 * /api/profile/answers: what MailFlow remembered from the user's "Is this for you?" answers
 * on the Summary tab. Shown in Settings so the user can see and remove them.
 *   GET            -> { answers: [{ id, answer: "yes" | "no", about: "audience" | "kind", text }] }
 *   DELETE ?id=a12 -> { removed: true }   one answer; without id, all of them
 * Only the signed-in user's own rows are read or removed. Answers are added by the todo route.
 */
async function currentUserId(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  return session ? { userId: session.userId } : undefined;
}
const signedOut = () => NextResponse.json({ connected: false }, { status: 401 });

export async function GET(request: NextRequest) {
  try {
    const user = await currentUserId(request);
    if (!user) return signedOut();
    const answers = user.userId === null ? [] : await listSummaryAnswers(user.userId);
    return NextResponse.json({ answers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Summary answers could not be read", error);
    return NextResponse.json({ error: "answers_failed" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? undefined;
  if (id !== undefined && !/^a\d{1,18}$/.test(id)) return NextResponse.json({ error: "invalid_answer" }, { status: 400 });
  try {
    const user = await currentUserId(request);
    if (!user) return signedOut();
    if (user.userId !== null) await deleteSummaryAnswers(user.userId, id);
    return NextResponse.json({ removed: true });
  } catch (error) {
    console.error("Summary answers could not be removed", error);
    return NextResponse.json({ error: "answers_failed" }, { status: 502 });
  }
}
