import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getGmailSession } from "@/lib/gmail-session";
import { CALENDAR_EVENTS_SCOPE, createGoogleOAuthClient } from "@/lib/google";
import { createHash } from "node:crypto";
import { validDate } from "@/lib/calendar-suggestion";

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; response?: { status?: unknown } };
  return typeof value.response?.status === "number" ? value.response.status : value.code;
}

function errorReasons(error: unknown) {
  if (!error || typeof error !== "object") return [];
  const data = (error as { response?: { data?: { error?: { errors?: Array<{ reason?: string }>; details?: Array<{ reason?: string }> } } } }).response?.data?.error;
  return [...(data?.errors ?? []), ...(data?.details ?? [])].flatMap((item) => item.reason ? [item.reason] : []);
}

async function calendarFor(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!tokens) return { kind: "signed_out" as const };
  if (tokens.scope && !tokens.scope.split(/\s+/).includes(CALENDAR_EVENTS_SCOPE)) {
    return { kind: "scope_missing" as const };
  }
  const auth = createGoogleOAuthClient();
  auth.setCredentials(tokens);
  return { kind: "ready" as const, calendar: google.calendar({ version: "v3", auth }) };
}

function failure(error: unknown) {
  const status = errorStatus(error);
  const reasons = errorReasons(error);
  if (reasons.includes("SERVICE_DISABLED") || reasons.includes("accessNotConfigured")) {
    return NextResponse.json({ error: "calendar_api_disabled" }, { status: 503 });
  }
  if (reasons.includes("rateLimitExceeded") || reasons.includes("userRateLimitExceeded") || status === 429) {
    return NextResponse.json({ error: "calendar_rate_limited" }, { status: 429 });
  }
  if (status === 401 || reasons.includes("insufficientPermissions") || reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
    return NextResponse.json({ error: "calendar_authorization_required" }, { status: 403 });
  }
  if (status === 403) {
    console.error("Google Calendar access denied", { reasons });
    return NextResponse.json({ error: "calendar_forbidden" }, { status: 403 });
  }
  console.error("Google Calendar API request failed", error);
  return NextResponse.json({ error: "calendar_request_failed" }, { status: 502 });
}

export async function GET(request: NextRequest) {
  const connection = await calendarFor(request);
  if (connection.kind === "signed_out") return NextResponse.json({ connected: false }, { status: 401 });
  if (connection.kind === "scope_missing") return NextResponse.json({ error: "calendar_authorization_required" }, { status: 403 });
  const calendar = connection.calendar;

  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");
  const startTime = start ? Date.parse(start) : NaN;
  const endTime = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime || endTime - startTime > 62 * 86400000) {
    return NextResponse.json({ error: "invalid_date_range" }, { status: 400 });
  }

  try {
    const events = [];
    let pageToken: string | undefined;
    do {
      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: new Date(startTime).toISOString(),
        timeMax: new Date(endTime).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      events.push(...(response.data.items ?? []).map((event) => ({
        id: event.id,
        title: event.summary ?? "(Untitled)",
        start: event.start?.dateTime ?? event.start?.date ?? null,
        end: event.end?.dateTime ?? event.end?.date ?? null,
        allDay: Boolean(event.start?.date),
        location: event.location ?? "",
        url: event.htmlLink ?? "",
      })));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken && events.length < 1000);
    return NextResponse.json({ events });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const connection = await calendarFor(request);
  if (connection.kind === "signed_out") return NextResponse.json({ connected: false }, { status: 401 });
  if (connection.kind === "scope_missing") return NextResponse.json({ error: "calendar_authorization_required" }, { status: 403 });
  const calendar = connection.calendar;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_event" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  const { title, start, end, location, description, allDay, sourceMessageId, sourceCandidateKey, approved } = body as Record<string, unknown>;
  if (sourceMessageId !== undefined && (approved !== true || typeof sourceMessageId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(sourceMessageId) || typeof sourceCandidateKey !== "string" || sourceCandidateKey.length > 500)) {
    return NextResponse.json({ error: "approval_required" }, { status: 400 });
  }
  if (allDay === true && (typeof start !== "string" || typeof end !== "string" || !validDate(start) || !validDate(end))) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  const startTime = typeof start === "string" ? Date.parse(start) : NaN;
  const endTime = typeof end === "string" ? Date.parse(end) : NaN;
  if (typeof title !== "string" || !title.trim() || title.length > 200 ||
      !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime ||
      endTime - startTime > 7 * 86400000 ||
      (location !== undefined && (typeof location !== "string" || location.length > 500)) ||
      (description !== undefined && (typeof description !== "string" || description.length > 8000))) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  // Stable event IDs make retries and simultaneous approvals idempotent, even
  // after a network timeout or on another server instance. Google IDs accept hex.
  const eventId = typeof sourceMessageId === "string"
    ? createHash("sha256").update(`mailflow:${sourceMessageId}:${sourceCandidateKey}`).digest("hex")
    : undefined;
  try {
    const response = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        id: eventId,
        summary: title.trim(),
        description: typeof description === "string" ? description.trim() : undefined,
        start: allDay === true ? { date: start as string } : { dateTime: new Date(startTime).toISOString() },
        end: allDay === true ? { date: end as string } : { dateTime: new Date(endTime).toISOString() },
        location: typeof location === "string" ? location.trim() : undefined,
        extendedProperties: typeof sourceMessageId === "string" ? { private: { mailflowMessageId: sourceMessageId } } : undefined,
      },
    });
    return NextResponse.json({ id: response.data.id, url: response.data.htmlLink }, { status: 201 });
  } catch (error) {
    if (eventId && errorStatus(error) === 409) {
      return NextResponse.json({ id: eventId, alreadyAdded: true });
    }
    return failure(error);
  }
}
