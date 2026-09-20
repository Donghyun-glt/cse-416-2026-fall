import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createGoogleOAuthClient, GMAIL_READONLY_SCOPE } from "@/lib/google";

export async function GET() {
  const state = randomBytes(32).toString("hex");
  const oauth2Client = createGoogleOAuthClient();
  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [GMAIL_READONLY_SCOPE],
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

  return response;
}

