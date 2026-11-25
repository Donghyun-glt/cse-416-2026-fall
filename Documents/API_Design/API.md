# MailFlow AI — Backend API

Last updated: 2026-11-25 (matches `main` at commit `75c4757`)

MailFlow AI is a single Next.js application. The backend is the set of Next.js route handlers under `frontend/src/app/api/`. This document describes every route that exists today. The production deployment is https://cse-416-2026-fall.vercel.app.

## Conventions

- **Base URL:** `http://localhost:3000` in development; the Vercel deployment URL in production.
- **Authentication:** every route except `GET /api/google/connect`, `GET /api/google/callback` and `POST /api/google/logout` requires the `gmail_session` cookie. The cookie is HTTP-only, `SameSite=Lax`, lasts 7 days, and holds an opaque session ID. Google OAuth tokens are encrypted with `SESSION_SECRET` and stored in PostgreSQL (`oauth_sessions`); they never reach the browser.
- **Missing or expired session:** `401` with `{ "connected": false }`. The analysis routes (`calendar-suggestions`, `insights`) and the Naver probe answer `401` with `{ "error": "signed_out" }` instead.
- **Per-user data:** rows in PostgreSQL are keyed by the signed-in user, and a route only reads or writes that user's rows. Text the app stores about a user (drafts, analyses, to-do text, profile entries) is encrypted with a per-user key.
- **Errors:** JSON `{ "error": "<stable_code>" }`. Upstream Google or Gemini failures return `502` unless noted.
- **Content type:** request and response bodies are JSON unless noted.

## Summary

| Method | URL | Purpose |
| --- | --- | --- |
| GET | `/api/google/connect` | Start Google OAuth |
| GET | `/api/google/callback` | Finish Google OAuth, create session |
| GET | `/api/google/profile` | Current user and granted scopes |
| POST | `/api/google/logout` | End the session |
| GET | `/api/gmail/messages` | Daily Briefing, mailbox lists, search, and the Summary list |
| GET | `/api/gmail/messages/changes` | Whether the mailbox changed since a list was loaded |
| POST | `/api/gmail/messages/insights` | Stored AI summaries and event suggestions for many messages |
| GET | `/api/gmail/messages/:id` | Full message: body and attachments |
| PATCH | `/api/gmail/messages/:id` | Read, unread, star, archive, spam, not spam, restore, set priority |
| DELETE | `/api/gmail/messages/:id` | Move a message to Trash |
| GET | `/api/gmail/messages/:id/attachments/:partId` | View or download an attachment |
| POST | `/api/gmail/messages/:id/calendar-suggestions` | Analyse a message: AI summary, priority, suggested events, Summary to-do |
| PUT | `/api/gmail/messages/:id/calendar-suggestions/state` | Remember what the user did with one suggested event |
| PUT | `/api/gmail/messages/:id/todo` | Summary item: mark done or open, record a sent reply, or answer "Is this for you?" |
| POST | `/api/gmail/messages/:id/reply-draft` | Generate an AI reply draft |
| GET, PUT, DELETE | `/api/gmail/messages/:id/reply-state` | The reply panel as the user last left it |
| POST | `/api/gmail/messages/:id/send` | Send a reply, reply-all, or forward |
| GET, POST, DELETE | `/api/gmail/messages/:id/draft` | Find, save, or discard the Gmail draft of a reply |
| POST | `/api/gmail/compose` | Send a new message |
| GET, POST, DELETE | `/api/gmail/compose/draft` | Open, save, or discard the Gmail draft of a new message |
| POST | `/api/gmail/compose/ai-draft` | Write or revise a new message with AI |
| GET | `/api/calendar/events` | Google Calendar events in a date range |
| POST | `/api/calendar/events` | Create a Google Calendar event the user approved |
| GET, PUT, DELETE | `/api/profile/about` | The optional "About you" details from Settings |
| GET, DELETE | `/api/profile/answers` | Remembered "Is this for you?" answers shown in Settings |
| POST | `/api/naver/imap-test`, `/api/naver/imap-test/seoul` | Experimental: check whether a Naver mailbox can be reached over IMAP |

## Authentication

### GET `/api/google/connect`

Starts the OAuth flow. Requests the scopes `gmail.modify`, `calendar.events`, `openid`, `email`, and `profile`.

| Query | Type | Notes |
| --- | --- | --- |
| `popup` | `"1"` (optional) | Login was opened in a popup; the callback then redirects to `/auth/google/complete` instead of `/`. |

- **Success:** `302` to Google's consent screen. Sets `gmail_oauth_state` and `gmail_oauth_popup` cookies (HTTP-only, 10 minutes).
- **Error:** if `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REDIRECT_URI` is missing, `302` back to the app with `?error=oauth_not_configured`.

### GET `/api/google/callback`

Google redirects here after consent.

| Query | Notes |
| --- | --- |
| `code` | Authorization code from Google |
| `state` | Must equal the `gmail_oauth_state` cookie |
| `error` | Set by Google when the user denies access |

- **Success:** exchanges the code for tokens, stores an encrypted session, sets the `gmail_session` cookie, and redirects (`302`) to `/` or `/auth/google/complete`.
- **Errors:** redirects with `?error=invalid_oauth_state`, `?error=token_exchange_failed`, or the error value Google returned.

### GET `/api/google/profile`

- **Success `200`:**

```json
{
  "connected": true,
  "name": "Display Name",
  "email": "user@gmail.com",
  "picture": "https://…",
  "requiresProfileAuthorization": false,
  "requiresMailboxAuthorization": false
}
```

`requiresProfileAuthorization` is true when the session predates the profile scopes. `requiresMailboxAuthorization` is true when the session lacks `gmail.modify`. In either case the client asks the user to log in again.

`picture` is the Google account photo, or empty when there is none.

- **Errors:** `401`; `502 profile_request_failed`.

### POST `/api/google/logout`

Deletes the stored session and clears the `gmail_session`, `gmail_oauth_state`, and `gmail_oauth_popup` cookies. It succeeds when there is no session.

- **Success:** `204` with no body.
- **Errors:** `403 invalid_logout_origin` (the request came from another site); `503 logout_failed`.

## Messages

### GET `/api/gmail/messages`

| Query | Type | Notes |
| --- | --- | --- |
| `after` | number (ms timestamp) | Daily Briefing mode: all INBOX messages received after this time. The server follows Gmail pagination until the whole day is collected. |
| `mode` | `inbox` \| `all` \| `starred` \| `drafts` \| `sent` \| `spam` \| `trash` \| `summary` | Mailbox view; default `all`. `summary` returns the Summary list described below. `inbox` returns only mail that still has the Gmail `INBOX` label, so archived mail is excluded. `all` returns all received mail, including archived mail, and excludes sent mail. Spam and Trash appear only in their own modes. Ignored when `after` is set. |
| `pageToken` | string | Next page for mailbox views (50 messages per page). |
| `attachment` | `"1"` (optional) | Mailbox views only: return only messages that have an attachment. |
| `unread` | `"1"` (optional) | Mailbox views only: return only unread messages. |
| `q` | string (optional, 500 characters) | Mailbox views only: search text, passed to Gmail's own search within the current mailbox, so message bodies are searched and operators such as `from:` work. A search in `all` also includes sent mail. |

- **Success `200`:**

```json
{
  "connected": true,
  "messages": [ Message ],
  "nextPageToken": "…",
  "resultSizeEstimate": 123,
  "historyId": "…"
}
```

`nextPageToken` and `resultSizeEstimate` are returned for mailbox views only. `historyId` is the mailbox's position when the list was read; the client passes it to `GET /api/gmail/messages/changes`. Daily Briefing results are sorted by priority (urgent, fyi, low) and then by date, newest first. Mailbox views keep Gmail's order.

**Message object**

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `threadId` | string | Gmail IDs |
| `subject`, `from`, `to`, `cc`, `date` | string | Header values |
| `snippet` | string | Gmail snippet |
| `unread`, `starred`, `draft` | boolean | From Gmail labels |
| `priority` | `urgent` \| `fyi` \| `low` | MailFlow classification; drafts are always `fyi` |
| `attachments` | array | Always empty in list responses; see `GET /api/gmail/messages/:id` |
| `unsubscribeUrl` | string | `https:` or `mailto:` target from the `List-Unsubscribe` header; empty when absent |
| `html` | string | Always empty in list responses; see `GET /api/gmail/messages/:id` |
| `partial` | `true` | Marks a list item whose body has not been loaded |
| `hasDraft` | boolean | True when the message's thread contains an unfinished reply saved in Drafts. The list shows a "Draft" marker for it. |

List responses are built from Gmail's `metadata` format (headers and snippet only) so a page loads without downloading 50 message bodies. Stored priorities for the whole page are read in one query. The first time a message is seen it is classified by rule and the result is stored in `message_priorities` and `priority_events`.

**Summary list (`mode=summary`)**

Returns `{ "connected": true, "messages": [ Message ], "pending": [ id ] }`. `messages` are the user's Summary items: open ones that are dated today or later, wait for a reply, or were added by hand, plus items finished in the last 7 days. Each carries two extra fields:

| Field | Type | Notes |
| --- | --- | --- |
| `summary` | string | The stored AI summary of the message, when there is one |
| `todo` | object | `{ task, dueDate, dueIsEvent, reasons, confirmAudience, status }`. `dueDate` is `YYYY-MM-DD` or `null`; `dueIsEvent` is true when that date is the day of an event the email mentions rather than a stated deadline; `reasons` is a list of `task`, `reply`, `event`, `manual`; `confirmAudience` asks the user "Is this for you?"; `status` is `open` or `done`. |

`pending` lists up to 20 recent messages (last 14 days, newest 50) that have not been analysed yet. The client sends each one to `POST /api/gmail/messages/:id/calendar-suggestions`, which is what adds new Summary items.

- **Errors:** `401` (body also contains `"messages": []`); `502 gmail_request_failed`.

### GET `/api/gmail/messages/changes`

Asks whether anything happened in the mailbox since a list was loaded (mail arrived, was read, starred, moved or deleted, in MailFlow or in Gmail itself). The client asks every 15 seconds and reloads a list only when the answer is `changed`.

| Query | Notes |
| --- | --- |
| `since` | The `historyId` returned with the list |

- **Success `200`:** `{ "changed": boolean, "historyId": "…" }`. When Gmail no longer keeps history that far back, the answer is `{ "changed": true }`.
- **Errors:** `400 invalid_history_id`; `401`; `502 gmail_request_failed`.

### POST `/api/gmail/messages/insights`

Returns the stored analyses of many messages at once, for the Daily Briefing cards. It is read-only: no Gmail call, no AI call, and no priority change.

Body: `{ "ids": [ string ] }` (at most 200 message IDs).

- **Success `200`:** `{ "insights": { "<id>": { "analysis": { "summary", "reason" }, "candidates": [ Suggestion ], "eventStates": { … } } } }`. Messages that have not been analysed yet are left out.
- **Errors:** `400 invalid_ids`; `401 signed_out`; `502 insights_unavailable`.

### GET `/api/gmail/messages/:id`

Returns the full message. The client calls this when the user opens a message.

- **Success `200`:** `{ "message": Message }` with every field from the list response, plus:

| Field | Type | Notes |
| --- | --- | --- |
| `html` | string | Sanitized HTML document rendered in a sandboxed iframe |
| `attachments` | array | `{ partId, filename, mimeType, size, inline, previewUrl, downloadUrl }` for each attachment; the URLs point at the attachment route |

`partial` is absent.

- **Errors:** `401`; `404 message_not_found`; `502 gmail_request_failed`.

### PATCH `/api/gmail/messages/:id`

Body:

```json
{ "action": "read" | "unread" | "star" | "archive" | "spam" | "notSpam" | "restore" | "priority",
  "starred": true,
  "priority": "urgent" | "fyi" | "low" }
```

| `action` | Effect | Success `200` body |
| --- | --- | --- |
| `read` (default when `action` is omitted) | Removes `UNREAD` | `{ "unread": false }` |
| `unread` | Adds `UNREAD` | `{ "ok": true, "action": "unread" }` |
| `star` | Adds or removes `STARRED` according to `starred` | `{ "starred": true }` |
| `archive` | Removes `INBOX` | `{ "ok": true, "action": "archive" }` |
| `spam` | Adds `SPAM`, removes `INBOX` | `{ "ok": true, "action": "spam" }` |
| `notSpam` | Removes `SPAM`, adds `INBOX` | `{ "ok": true, "action": "notSpam" }` |
| `restore` | Untrashes the message | `{ "restored": true }` |
| `priority` | Records a manual priority in PostgreSQL | `{ "priority": "urgent" }` |

- **Errors:** `400 invalid_priority`; `401`; `502 gmail_modify_failed`.

### DELETE `/api/gmail/messages/:id`

Moves the message to Gmail Trash (recoverable with `restore`).

- **Success `200`:** `{ "trashed": true }`
- **Errors:** `401`; `502 gmail_trash_failed`.

### GET `/api/gmail/messages/:id/attachments/:partId`

Returns the attachment bytes, not JSON.

| Query | Notes |
| --- | --- |
| `download=1` | Force `Content-Disposition: attachment`. |

PNG, JPEG, GIF, WebP, and PDF are served inline unless `download=1`; every other type is always a download. Responses carry `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

- **Errors:** `401`; `404 attachment_not_found`; `404 attachment_empty`; `502 attachment_request_failed`.

## AI reply

### POST `/api/gmail/messages/:id/reply-draft`

Generates a reply draft with Google Gemini. Nothing is sent; the user edits the draft and sends it through `/send`.

Body (all fields optional):

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `tone` | `professional` \| `friendly` \| `concise` \| `formal` | `professional` | |
| `length` | `short` \| `medium` \| `long` | `medium` | |
| `instructions` | string | `""` | Extra guidance, truncated to 500 characters |
| `currentDraft` | string | — | With `instructions`: revise this draft instead of starting over |
| `regenerate` | boolean | `false` | Skip the cache and call the model again |

- **Success `200`:**

```json
{ "draft": "…", "model": "gemini-3.5-flash-lite", "cached": false, "generatedAt": "2026-11-08T09:00:00.000Z" }
```

Drafts are cached in `reply_drafts` per (user, message, tone, length, instructions), so reopening a message does not call the model again. The message body sent to the model is capped at 6,000 characters, and the model call times out after 30 seconds.

- **Errors:**

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_options` | Unknown `tone` or `length` |
| 401 | — | No session |
| 429 | `ai_rate_limited` | Gemini quota reached |
| 502 | `gmail_fetch_failed` | Could not load the user or the original message |
| 502 | `ai_request_failed`, `ai_empty_response` | Gemini call failed or returned nothing |
| 503 | `ai_not_configured` | `GEMINI_API_KEY` is not set |

AI errors also include a `detail` string with the model name.

### POST `/api/gmail/messages/:id/send`

Sends mail from the user's Gmail account. The client calls this only after the user reviews the text and confirms.

The route accepts two request formats.

**JSON** (`Content-Type: application/json`): plain-text message. Used when sending the AI suggested reply.

**Form data** (`Content-Type: multipart/form-data`): formatted message with optional new attachments. Used by the composer.

| Field | Type | Formats | Notes |
| --- | --- | --- | --- |
| `action` | `reply` \| `replyAll` \| `forward` | both | Required |
| `body` | string | both | Required, non-empty. Plain-text version of the message. |
| `to` | string | both | Required for `forward`; comma-separated addresses |
| `html` | string | form data | Formatted version of the message (fonts, sizes, bold, italic, underline, lists). Sanitized on the server: scripts, event handlers, embedded content, and `javascript:` links are removed. |
| `files` | file, repeatable | form data | New attachments, 4 MB in total |
| `draftId` | string | form data | Optional. The autosaved draft for this message; it is deleted after the message is sent. |

- `reply` goes to the original `Reply-To` or `From` address, in the same thread, with the original message quoted.
- `replyAll` also copies the original `To` and `Cc` recipients, excluding the user.
- `forward` includes the original text and re-attaches the original attachments, followed by any new `files`.
- When `html` is present the message is sent as `multipart/alternative` (plain text and HTML). Attachments wrap it in `multipart/mixed`.

- **Success `200`:** `{ "sent": true }`
- **Errors:** `400 invalid_message`; `400 reply_address_missing`; `400 forward_address_missing`; `401`; `413 attachments_too_large`; `502 gmail_send_failed`.

### GET `/api/gmail/messages/:id/draft`

Finds the draft that belongs with a message, so the composer can be reopened where the user left off. `:id` may be either side of the pair.

- **`:id` is a received message:** returns the reply draft written for it, if one exists in the same thread.
- **`:id` is a draft message:** returns its content and `sourceId`, the message it answers. The source is read from the `X-MailFlow-Source` header on drafts MailFlow saved, or looked up from `In-Reply-To` for drafts written in Gmail.

- **Success `200`:**

```json
{
  "sourceId": "18c…",
  "draft": {
    "draftId": "r123…",
    "messageId": "18d…",
    "action": "reply",
    "to": "",
    "html": "<b>Thanks</b>, see you then.",
    "text": "Thanks, see you then.",
    "attachments": [{ "filename": "notes.pdf", "mimeType": "application/pdf", "size": 48211, "downloadUrl": "/api/gmail/messages/18d…/attachments/2?download=1" }]
  }
}
```

`draft` is `null` when the message has no draft. `sourceId` is `null` when a draft answers no message MailFlow can find. `html` and `text` contain only what the user wrote; the quoted original is left out. For a forward draft, `attachments` lists only the files the user added, not the original's attachments.

- **Errors:** `401`; `404 message_not_found`; `502 gmail_draft_failed`.

### POST `/api/gmail/messages/:id/draft`

Saves an unfinished reply or forward to the user's Gmail Drafts. The composer calls this automatically about 1.5 seconds after the user stops typing, and when the user leaves the message. `:id` is the message being answered.

Takes the same form data as `/send` (`action`, `body`, `html`, `to`, `files`, `draftId`), with two differences: nothing is sent, and a `forward` may be saved before a recipient is entered.

- Without `draftId` a new draft is created. With `draftId` that draft is replaced. If that draft no longer exists (for example it was deleted in Gmail), a new one is created.
- Reply drafts are attached to the original thread.
- Saved drafts carry two extra headers, `X-MailFlow-Source` (the message being answered) and `X-MailFlow-Action`, so they can be reopened. These headers are not included when the message is sent.

- **Success `200`:** `{ "draftId": "r123…" }`
- **Errors:** `400 invalid_message`; `400 reply_address_missing`; `401`; `413 attachments_too_large`; `502 gmail_draft_failed`.

### DELETE `/api/gmail/messages/:id/draft`

| Query | Notes |
| --- | --- |
| `draftId` | Required. The draft to discard. |

Permanently deletes the draft. Deleting a draft that is already gone succeeds.

- **Success `200`:** `{ "discarded": true }`
- **Errors:** `400 draft_id_missing`; `401`; `502 gmail_draft_failed`.

### `/api/gmail/messages/:id/reply-state`

The reply panel as the user last left it for a message, so reopening the message shows their edited draft and settings instead of a new AI draft. Nothing here calls the model or sends mail.

| Method | Body | Success `200` |
| --- | --- | --- |
| GET | — | `{ "state": { "draft", "tone", "length", "instructions" } \| null }` |
| PUT | `{ "draft", "tone", "length", "instructions" }` (draft up to 20,000 characters, instructions up to 500) | `{ "saved": true }` |
| DELETE | — | `{ "deleted": true }` (after sending, or when the draft was cleared) |

- **Errors:** `400 invalid_message`; `400 invalid_state`; `401`; `502 reply_state_failed`.

## Compose

### POST `/api/gmail/compose`

Sends a new message written in the Compose window. Sending happens only on this explicit request from the signed-in user.

Body: `multipart/form-data`, or JSON when there are no files.

| Field | Notes |
| --- | --- |
| `to`, `cc`, `bcc` | Recipients; at least one is required |
| `subject` | Optional |
| `body` | Plain-text version |
| `html` | Formatted version (optional) |
| `files` | Attachments, 4 MB in total (form data only) |
| `draftId` | The autosaved draft of this message; it is removed once the message is sent |

- **Success `200`:** `{ "sent": true }`
- **Errors:** `400 invalid_recipient` (with `invalid`, the list of rejected addresses), `recipient_missing`, `empty_message`, `invalid_message`; `401`; `413 attachments_too_large`; `502 gmail_send_failed`.

### `/api/gmail/compose/draft`

Autosaves the Compose window as a Gmail draft, whatever state it is in (a draft may have no recipient or a mistyped one).

| Method | Input | Success `200` |
| --- | --- | --- |
| GET | `?messageId=` (a message from the Drafts list) | `{ "draft": { "draftId", "to", "cc", "bcc", "subject", "html", "attachments" } \| null }` |
| POST | Same form data as `/api/gmail/compose`. Without `draftId` a draft is created; with it that draft is replaced. | `{ "draftId", "messageId" }` |
| DELETE | `?draftId=` | Succeeds even when the draft is already gone |

- **Errors:** `400 message_id_missing`; `400 draft_id_missing`; `401`; `502 gmail_draft_failed`.

### POST `/api/gmail/compose/ai-draft`

Writes text for the Compose window with Google Gemini. Nothing is saved or sent: the text appears in the editor for the user to review.

| Field | Type | Notes |
| --- | --- | --- |
| `instructions` | string (required) | What the message should say |
| `tone` | `professional` \| `friendly` \| `concise` \| `formal` | Optional |
| `length` | `short` \| `medium` \| `long` | Optional |
| `to`, `subject`, `senderName` | string | Optional context |
| `currentBody` | string | When present, the model revises this text instead of starting over |

- **Success `200`:** `{ "subject": "…", "body": "…", "model": "…" }`
- **Errors:** `400 invalid_request`; `401`; `429 ai_rate_limited`; `502 ai_request_failed`, `ai_empty_response`; `503 ai_not_configured`, `ai_unavailable`.

## Message analysis and Email-to-Calendar

### POST `/api/gmail/messages/:id/calendar-suggestions`

Analyses one message with Google Gemini. One call produces the AI summary, the priority (Urgent, FYI, or Low), the suggested calendar events, and the decision whether the message goes on the Summary list. A message is analysed once: the validated result is stored per user and message, and later calls return the stored result without calling Gmail or the model. This route replaces the `POST /api/ai/summary` and `POST /api/calendar/event-preview` routes that the Software Design Document planned.

Body: `{ "timeZone": "Asia/Seoul" }` (optional IANA time zone, used to resolve dates such as "tomorrow").

- **Success `200`:**

```json
{
  "analysis": { "priority": "fyi", "importance": "normal", "summary": "…", "reason": "…", "reviewNotes": [], "candidates": [ Suggestion ] },
  "candidates": [ Suggestion ],
  "eventStates": { "<key>": { "status": "saved", "details": { } } },
  "todo": { "task": "…", "dueDate": "2026-12-01", "dueIsEvent": false, "reasons": ["task"], "confirmAudience": false, "status": "open" },
  "priority": "fyi",
  "prioritySaved": true,
  "version": "content-v6"
}
```

A stored result is returned with `"stored": true` and `"prioritySaved": false`. `todo` is `null` when the message is not on the Summary list. Spam, Trash, Sent, and Draft messages are not analysed and return `{ "candidates": [], "note": "…" }`.

**Suggestion object:** `{ title, kind: "appointment" | "deadline", date, startTime, endTime, timeZone, location, evidence, reason }`. `evidence` is an exact quote from the email; a suggestion whose quote is not found in the email is dropped.

The model reports facts with quotes, and the server checks every quote against the email text before using it. An automatic priority never overwrites one the user set by hand. The Summary decision is separate from the priority and uses the user's "About you" details and their earlier "Is this for you?" answers.

- **Errors:** `401 signed_out`; `429 rate_limited` (with `Retry-After`); `503` for a temporary Gemini failure (with `Retry-After`) or `not_configured`; `502 analysis_failed`, or `502` with Gemini's own failure code (`request_failed`, `empty_response`).

### PUT `/api/gmail/messages/:id/calendar-suggestions/state`

Remembers what the user last did with one suggested event: the details as they edited them, and whether they added or dismissed it. This never creates a calendar event; `POST /api/calendar/events` does, on approval.

Body: `{ "key": "<suggestion key>", "status": "pending" | "saved" | "dismissed", "details": { title, date, start, end, zone, location, description, allDay } }`

- **Success `200`:** `{ "saved": true }`. When every suggested event of the message is added or dismissed, the `event` reason is removed from its Summary item.
- **Errors:** `400 invalid_state`; `401`; `502 event_state_failed`.

### PUT `/api/gmail/messages/:id/todo`

The user's own handling of a Summary item. The body is one of:

| Body | Effect |
| --- | --- |
| `{ "status": "open" \| "done" \| "not_relevant", "today": "YYYY-MM-DD" }` | Marks the item. `open` on a message that is not listed adds it by hand. `today` is the user's calendar day, used when an item is reopened. |
| `{ "resolved": "reply" }` | The reply was sent; the item is done when no other reason is left. |
| `{ "forMe": true \| false }` | Answer to "Is this for you?": `true` keeps the item, `false` removes it. The answer may be remembered for similar mail (see `/api/profile/answers`). |

- **Success `200`:** `{ "todo": … }` as it now stands.
- **Errors:** `400 invalid_todo`; `401`; `502 todo_failed`.

## Calendar

Both routes need the `calendar.events` scope. A session without it gets `403 calendar_authorization_required`, and the client asks the user to log in again.

### GET `/api/calendar/events`

| Query | Notes |
| --- | --- |
| `start`, `end` | Date range (ISO 8601), at most 62 days |

- **Success `200`:** `{ "events": [ { "id", "title", "start", "end", "allDay", "location", "url" } ] }` from the user's primary Google Calendar.
- **Errors:** `400 invalid_date_range`; `401`; `403 calendar_authorization_required`, `calendar_forbidden`; `429 calendar_rate_limited`; `502 calendar_request_failed`; `503 calendar_api_disabled`.

### POST `/api/calendar/events`

Creates an event in the user's primary Google Calendar.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Required, up to 200 characters |
| `start`, `end` | string | ISO 8601 date-times, or `YYYY-MM-DD` dates when `allDay` is true; at most 7 days apart |
| `allDay` | boolean | Optional |
| `location`, `description` | string | Optional |
| `sourceMessageId`, `sourceCandidateKey` | string | Set when the event comes from an email suggestion |
| `approved` | `true` | Required with `sourceMessageId`: an event from an email is created only after the user approved it |

- **Success `201`:** `{ "id", "url" }`. An event from an email gets a stable ID, so approving the same suggestion twice returns `200 { "id", "url", "alreadyAdded": true }` instead of creating a duplicate; an event the user deleted in Google Calendar is restored (`"restored": true`).
- **Errors:** `400 invalid_event`; `400 approval_required`; `401`; `403`, `429`, `502`, `503` as for GET.

## Profile and settings

### `/api/profile/about`

The optional details a user enters about themselves in Settings. They are used only to decide whether an email is meant for the user. This route is the only writer: the values are what the user typed and are never changed by an AI step.

| Method | Body | Success `200` |
| --- | --- | --- |
| GET | — | `{ "about": { "role", "organization", "interests", "notes" }, "updatedAt": string \| null }` |
| PUT | The same four fields, all optional free text | `{ "about", "updatedAt" }` |
| DELETE | — | `{ "cleared": true }` |

- **Errors:** `400 invalid_about`; `401`; `502 about_failed`.

### `/api/profile/answers`

What MailFlow remembered from the user's "Is this for you?" answers on the Summary tab. Settings shows them so the user can remove them.

| Method | Input | Success `200` |
| --- | --- | --- |
| GET | — | `{ "answers": [ { "id", "answer": "yes" \| "no", "about": "audience" \| "kind", "text" } ] }` |
| DELETE | `?id=a12` for one answer; no `id` for all of them | `{ "removed": true }` |

- **Errors:** `400 invalid_answer`; `401`; `502 answers_failed`.

## Experimental

### POST `/api/naver/imap-test` and `/api/naver/imap-test/seoul`

A probe for the planned Naver Mail support. It tries one IMAP login to `imap.naver.com` from the deployment region (the second route runs in the Seoul region) and reports the result. No Naver mail is read or stored, and the password is used for that one login only and is never logged.

Body: `{ "address": "name@naver.com", "appPassword": "…" }` (`appPassword` optional).

- **Success `200`:** `{ "region": "…", … }` with the outcome of the connection and login.
- **Errors:** `400 invalid_input`; `401 signed_out`.

## Changes from the Software Design Document

- AI reply draft moved from the planned `POST /api/ai/reply-draft` to `POST /api/gmail/messages/:id/reply-draft`. It takes `tone`, `length`, `instructions`, and `regenerate`, and returns `{ draft, model, cached, generatedAt }` instead of `{ messageId, draft: { subject, body } }`.
- Added `POST /api/gmail/messages/:id/send` and `GET /api/gmail/messages/:id/attachments/:partId`.
- `PATCH /api/gmail/messages/:id` gained the `unread`, `archive`, `spam`, and `notSpam` actions.
- `GET /api/gmail/messages` gained `mode=inbox`, `mode=sent`, and `mode=spam`; `mode=all` no longer includes sent mail.
- Added `GET /api/gmail/messages/:id`. List responses no longer include message bodies or attachments.
- `POST /api/gmail/messages/:id/send` also accepts form data with an HTML body and file attachments.
- Added `POST` and `DELETE /api/gmail/messages/:id/draft` for draft autosave.
- Storage moved from local SQLite and an in-memory session map to PostgreSQL with encrypted sessions.
- Added `POST /api/google/logout`.
- The planned `POST /api/ai/summary` and `POST /api/calendar/event-preview` became one route, `POST /api/gmail/messages/:id/calendar-suggestions`. A message is analysed once, and that one model call returns the summary, the priority, the suggested events, and the Summary decision.
- `POST /api/calendar/events` requires `approved: true` for an event that comes from an email, and `GET /api/calendar/events` was added for the calendar view.
- Added the Summary list (`GET /api/gmail/messages?mode=summary`, `PUT /api/gmail/messages/:id/todo`), which was not in the Software Design Document.
- Added Compose (`/api/gmail/compose`, `/api/gmail/compose/draft`, `/api/gmail/compose/ai-draft`).
- Added `/api/profile/about` and `/api/profile/answers` for the Settings page.
- Added `GET /api/gmail/messages/changes` and `POST /api/gmail/messages/insights` so lists and Daily Briefing cards load without repeating Gmail or AI calls.
- `GET /api/gmail/messages` gained `q` (search) and returns `historyId`.
- Text stored about a user is encrypted with a per-user key.
