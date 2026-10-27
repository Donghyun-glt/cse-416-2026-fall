import { type NextRequest, NextResponse } from "next/server";
import { createGoogleOAuthClient } from "@/lib/google";
import { sealGmailSession } from "@/lib/gmail-session";

function redirectAfterLogin(request: NextRequest, error?: string) {
  const popup = request.cookies.get("gmail_oauth_popup")?.value === "1";
  const url = new URL(popup ? "/auth/google/complete" : "/", request.url);
  if (error) url.searchParams.set("error", error);
  const response = NextResponse.redirect(url);
  response.cookies.delete("gmail_oauth_state");
  response.cookies.delete("gmail_oauth_popup");
  return response;
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get("gmail_oauth_state")?.value;

  if (!returnedState || !savedState || returnedState !== savedState) {
    return redirectAfterLogin(request, "invalid_oauth_state");
  }
  if (error) return redirectAfterLogin(request, error);
  if (!code) return redirectAfterLogin(request, "invalid_oauth_state");

  try {
    const oauth2Client = createGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    const session = sealGmailSession(tokens);

    const response = redirectAfterLogin(request);
    response.cookies.set("gmail_session", session, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (oauthError) {
    console.error("Google OAuth callback failed", oauthError);
    return redirectAfterLogin(request, "token_exchange_failed");
  }
}

