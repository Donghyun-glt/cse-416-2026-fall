import { type NextRequest, NextResponse } from "next/server";
import { deleteGmailSession } from "@/lib/gmail-session";

export async function POST(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return NextResponse.json({ error: "invalid_logout_origin" }, { status: 403 });
  }

  const sessionId = request.cookies.get("gmail_session")?.value;
  try {
    if (sessionId) await deleteGmailSession(sessionId);
  } catch (error) {
    console.error("Could not end the Gmail session", error);
    return NextResponse.json({ error: "logout_failed" }, { status: 503 });
  }

  const response = new NextResponse(null, { status: 204 });
  for (const name of ["gmail_session", "gmail_oauth_state", "gmail_oauth_popup"]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
