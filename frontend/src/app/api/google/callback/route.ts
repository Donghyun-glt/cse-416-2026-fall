import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { createGoogleOAuthClient } from "@/lib/google";
import { saveGmailSession } from "@/lib/gmail-session";

function redirectWithError(request: NextRequest, error: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  if (error) return redirectWithError(request, error);

  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get("gmail_oauth_state")?.value;

  if (!code || !returnedState || !savedState || returnedState !== savedState) {
    return redirectWithError(request, "invalid_oauth_state");
  }

  try {
    const oauth2Client = createGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    const sessionId = randomBytes(32).toString("hex");
    saveGmailSession(sessionId, tokens);

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.delete("gmail_oauth_state");
    response.cookies.set("gmail_session", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (oauthError) {
    console.error("Google OAuth callback failed", oauthError);
    return redirectWithError(request, "token_exchange_failed");
  }
}

