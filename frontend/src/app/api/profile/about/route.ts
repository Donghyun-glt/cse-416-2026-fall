import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSessionWithUser } from "@/lib/gmail-session";
import { deleteUserAbout, getUserAbout, saveUserAbout, upsertUser } from "@/lib/mailflow-db";
import { EMPTY_ABOUT, parseUserAbout } from "@/lib/user-about";

/**
 * /api/profile/about: the optional details a user enters about themselves in Settings.
 *   GET    -> { about: { role, organization, department, interests, notes }, updatedAt: string | null }
 *   PUT    body: the same five fields (all optional) -> { about, updatedAt }
 *   DELETE -> { cleared: true }
 * Only the signed-in user's own row is read or written, and this route is the only
 * writer: values come from what the user typed, never from an AI step.
 */
async function currentUser(request: NextRequest, create: boolean) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!sessionId || !session) return undefined;
  let userId = session.userId;
  if (userId === null && create) {
    // A session that has not used a stored feature yet is not linked to a user row.
    const auth = createGoogleOAuthClient(); auth.setCredentials(session.tokens);
    const profile = await google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
    userId = await upsertUser(profile.data.emailAddress ?? "");
    await attachGmailSessionToUser(sessionId, userId);
  }
  return { userId };
}
const signedOut = () => NextResponse.json({ connected: false }, { status: 401 });
const failed = (action: string, error: unknown) => {
  console.error(`About-you details could not be ${action}`, error);
  return NextResponse.json({ error: "about_failed" }, { status: 502 });
};

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser(request, false);
    if (!user) return signedOut();
    const stored = user.userId === null ? null : await getUserAbout(user.userId);
    const { updatedAt = null, ...about } = stored ?? { ...EMPTY_ABOUT, updatedAt: null };
    return NextResponse.json({ about, updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failed("read", error); }
}

export async function PUT(request: NextRequest) {
  const about = parseUserAbout(await request.json().catch(() => null));
  if (!about) return NextResponse.json({ error: "invalid_about" }, { status: 400 });
  try {
    const user = await currentUser(request, true);
    if (!user) return signedOut();
    return NextResponse.json({ about, updatedAt: await saveUserAbout(user.userId!, about) });
  } catch (error) { return failed("saved", error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await currentUser(request, false);
    if (!user) return signedOut();
    if (user.userId !== null) await deleteUserAbout(user.userId);
    return NextResponse.json({ cleared: true });
  } catch (error) { return failed("cleared", error); }
}
