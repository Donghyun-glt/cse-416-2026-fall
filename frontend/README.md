# MailFlow frontend

## Google login

Users visit the hosted application, click **Log in with Google**, select their
personal account, and grant Gmail access. The popup closes and MailFlow loads
their inbox. If popups are blocked, login uses a regular page redirect.
Users do not create Google Cloud projects or edit environment files.

The MailFlow team configures one application OAuth client per environment:

1. Create a Google Cloud project and enable Gmail API and Google Calendar API.
2. Configure the Google Auth Platform consent screen and a web OAuth client.
3. Register the exact callback URL, such as
   `https://your-domain.com/api/google/callback`.
4. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
   `GOOGLE_REDIRECT_URI` in the hosting service's server environment settings.
   Keep the secret server-side; do not use a `NEXT_PUBLIC_` prefix.
5. Deploy the application and share its URL with users.

For local development, copy the repository's `.env.example` to
`frontend/.env.local`, fill in the team's development credentials, and register
`http://localhost:3000/api/google/callback` with Google. Developers running a
local server need the application configuration; users of the hosted app do not.

The app requests `openid`, `email`, `profile`, `gmail.modify`, and `calendar.events`.
Existing users must reconnect Google once to grant the new calendar permission.
The Calendar screen reads events from the user's primary calendar and saves new
events there only after the user submits the event form. In Google's
Testing mode, add your demo users to the test-user list; Gmail authorizations
expire after seven days. A public launch requires the applicable restricted-scope
verification and security assessment. See
[Google's scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes)
and [audience settings](https://support.google.com/cloud/answer/15549945).

Sessions use opaque browser cookies backed by PostgreSQL. Google OAuth tokens
are encrypted with `SESSION_SECRET` before storage, so sessions survive process
restarts and work across serverless instances.

## Content analysis and calendar suggestions

Opening an eligible received message runs one full-body Gemini analysis and shows
**Email insights** in English. It separately assesses personal relevance, impact,
and urgency; extracts grounded actions, deadlines, preparation, consequences,
logistics, changes and useful information; and proposes confirmed personal calendar
commitments. Automated senders and mailing-list headers do not exclude a message.
Each key point has a **Source text** quotation. Important mail can have no event.

Lists initially use inexpensive metadata rules. Opening a message refines its
stored automatic priority from the full body; the list and detail badge update
when that analysis completes. Manual choices always win, including concurrent
edits. Importance and urgency are separate: a consequential future obligation can
be Important while its mailbox category remains FYI until it becomes time-sensitive.
Unopened messages are not all sent to Gemini in the background.

The server validates source quotations, numeric claims, personal relevance, date,
time, zone and location evidence. Date formats include year-first dotted/slashed/
dashed dates, Korean dates, English month names in either order and unambiguous
numeric dates. Today/tomorrow/in N days resolve from the email date in the supplied
reference zone, with a review warning. Missing years are inferred with a warning;
ambiguous numeric dates, two-digit years and uncertain weekdays need clarification.
Dates and times may be in different paragraphs. Arrival/cutoff/preparation details
are attached to the main event instead of becoming extra appointments.

Changes/cancellations remain visible as important information but do not create
or edit calendar entries. A newer conversation message suppresses calendar proposals
from the older message while preserving its analysis. Optional promotions and other
people's commitments are not calendar candidates. Quoted context is available to
the model, which is instructed to prioritize the latest instructions. No semantic
classifier can guarantee perfect interpretation; the review step remains required.

The analysis endpoint never writes to Calendar. **Review event** lets the user
correct the extracted values and **Save to Google Calendar** requires explicit
confirmation. Missing end times/time zones need input. Date-only deadlines can be
all-day events. Location is copied only with supporting evidence. Attachments and
recurring schedules are not parsed. Analysis is capped at 40,000 characters and
flags truncation. A bounded account-scoped memory cache retains generated analysis
for up to 10 minutes; generated insights and email bodies are not stored in the
DB. Only fixed priority explanations and classification signals are persisted.

Email suggestions use stable Google event IDs so retries for the same message/
date/time/type do not create another event. This does not deduplicate independently
created events or the same appointment in different messages. Browser flags remember
dismissal/saving; no migration is needed.

`npm test` covers validators, priorities, manual overrides, dates, time zones and
approval/retry behavior. The synthetic multilingual fixtures also exercise the
actual model; run from `frontend/` with configured Gemini credentials:

```bash
node --env-file=.env scripts/evaluate-mail-analysis.cjs
# Or select named fixtures to control API usage:
node --env-file=.env scripts/evaluate-mail-analysis.cjs marketing-urgency routine-receipt
```

This small synthetic suite is a regression check, not a measured accuracy rate on
real inboxes. Add anonymized, labelled examples from different domains before
claiming broad accuracy. Classification errors should be fixed at the shared
logic/prompt level, rather than by matching a specific sender or subject.

## PostgreSQL database

MailFlow uses a managed PostgreSQL database in local and hosted environments.
Gmail remains the source of truth for message content and mailbox state, while
PostgreSQL stores MailFlow-owned data:

- Gmail account email and optional display name
- Gmail message ID, current priority, and last-seen time
- Whether a priority came from automatic rules or a manual override
- The rule explanation and boolean signals used by automatic classification
- An append-only history of priority changes
- Encrypted Google OAuth session tokens and their expiration times

MailFlow does not copy message subjects, bodies, attachments, passwords, or
Gmail labels into PostgreSQL. Priority categories are not written back to Gmail.

Set `DATABASE_URL` to a PostgreSQL connection string that requires TLS and set a
long random `SESSION_SECRET`. After provisioning a new database, run migrations
from `frontend/`:

```bash
npm run db:migrate
```

After loading mail in the app, inspect classification totals and recent changes:

```bash
npm run db:inspect
```

## Development

Run these commands from `frontend/`:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Use `localhost` for local Google login rather than the LAN IP shown by Next.js.
Next.js blocks dev-only resources from unapproved origins, and Google's callback
must return to the same origin that started login so the OAuth cookie is available.
The login link still works as a regular redirect if client JavaScript has not loaded.
If the application credentials are missing, the welcome screen explains that the
MailFlow team needs to enable Google login.

## Checks

```bash
npm run test
npm run lint
npm run build
```

The OAuth route tests use a mocked Google service and need no real credentials.
A real Google account is needed to verify Google's consent screen end to end.
