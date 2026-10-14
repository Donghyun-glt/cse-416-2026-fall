import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  createGoogleOAuthClient,
  GMAIL_MODIFY_SCOPE,
  GOOGLE_PROFILE_SCOPES,
} from "@/lib/google";

export async function GET(request: NextRequest) {
  const popup = request.nextUrl.searchParams.get("popup") === "1";
  const state = randomBytes(32).toString("hex");
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    const url = new URL(popup ? "/auth/google/complete" : "/", request.url);
    url.searchParams.set("error", "oauth_not_configured");
    return NextResponse.redirect(url);
  }
  const oauth2Client = createGoogleOAuthClient();
  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: true,
    scope: [GMAIL_MODIFY_SCOPE, ...GOOGLE_PROFILE_SCOPES],
    state,
  });

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  response.cookies.set("gmail_oauth_popup", popup ? "1" : "0", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}

