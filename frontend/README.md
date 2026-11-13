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
