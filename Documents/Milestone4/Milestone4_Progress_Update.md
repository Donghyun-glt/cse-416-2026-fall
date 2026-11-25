# MailFlow AI — Milestone 4 Progress Update

CSE 416 · Fall 2026 · Team: Donghyun Lim, Seunghoon Jang

Beta link: https://cse-416-2026-fall.vercel.app/

Repository: https://github.com/Donghyun-glt/cse-416-2026-fall

## Schedule reference

The Software Design Document (section 9) scheduled the work as four ordered milestones without per-person owners. Per-person assignments below follow the Jira board and the commit history.

| Order | Milestone | Deliverables |
| --- | --- | --- |
| 1 | Deployment foundation | Persistent encrypted sessions, managed database, stable production build |
| 2 | AI summary and reply | Model service, prompt boundary, editable draft, evaluation cases |
| 3 | Calendar integration | Date extraction, event preview, approval, Calendar API |
| 4 | Hardening | End-to-end tests, monitoring, privacy review, user personalization |

Change from the Software Design Document: milestone 4 was originally “End-to-end tests, monitoring, rate handling, and privacy review”. Rate handling is finished, and user personalization was added to this milestone.

## 1. Individual Progress Updates

### Donghyun Lim

**Scheduled to be complete by this milestone**

- Gmail message loading, All Emails and Daily Briefing views
- Message actions (read, star, trash, restore)
- Managed PostgreSQL storage (Deployment foundation)
- AI reply draft generation (AI summary and reply)
- AI summary of an opened message (AI summary and reply)

**Scheduled to be in progress by this milestone**

- *Nothing in progress.*

**Actually completed** (committed and merged into `main`)

- Gmail-connected prototype: message loading, session helpers, API routes, mail client (`609335e`)
- All Emails and Daily Briefing views with Gmail message actions (`31c338a`)
- All Emails loading order and pagination, with tests (`291d550`)
- Priority-classification storage, first in SQLite (`fdfa4c8`), then moved to PostgreSQL with migrations (`3706d38`)
- Attachment viewing and download; reply, reply-all, and forward, including forwarding attachments; archive, spam, and mark-unread actions (`67315df`, `8ca1a72`)
- AI reply drafts with Google Gemini: prompt builder, tone and length options, draft caching in PostgreSQL, reply editor UI, unit tests and fixture emails (`2a7c14e`, `3e3d25d`)
- Sent mailbox view (`6138ee3`)
- Inbox view (`8ae0db1`); selecting several messages and acting on them at once (`ef4d88c`)
- Reworked reply composer and send route, with tests (`a5da4c2`); automatic saving of replies to Gmail Drafts (`1db92db`); browser Back support and draft clean-up (`481a7c8`)
- AI reply panel: tone and length sliders, a box for asking the AI to change the draft, and the panel restored as the user left it (`a86ff36`, `bf597a9`)
- Simpler, editable “add to calendar” preview for suggested events (`8a4e824`)
- Daily Briefing as priority groups with an AI summary on each card (`26fef43`)
- Compose: new messages with recipients, formatting, attachments, and automatic drafts (`6ab5603`)
- Summary to-do list: decides from the email text whether a message still needs the user, with tests (`9ca599c`, `fa7cd38`, `75c4757`)
- User personalization: “About you” details in Settings (`9ca599c`, `ed056f6`), “Is this for you?” answers, the personalization history, and a button that deletes them (`fa7cd38`, `2de83f9`)
- Privacy: text stored about a user is encrypted with a per-user key, existing data was encrypted, and development uses a separate database (`df9e0e9`, `a6ab528`)
- Interface fixes: dark mode (`c7b639e`), opened mail shown on a gray row (`d1054e1`), AI panel that follows the page scroll (`d07ded7`, `d0873fc`)
- Experimental Naver IMAP connection check (`fb18d37`)

**Partially completed**

- *Nothing partially completed.*

### Seunghoon Jang

**Scheduled to be complete by this milestone**

- Google OAuth login flow
- Priority classification (Urgent / FYI / Low Priority) and manual override
- Calendar view and HTML mail viewer
- Persistent encrypted sessions (Deployment foundation)
- Vercel deployment (Deployment foundation)
- Ui fix and beautify

**Scheduled to be in progress by this milestone**

- *Nothing in progress*

**Actually completed** (committed and merged into `main`)

- Calendar view, HTML email viewer, and MIME parsing (`516322e`)
- Google OAuth login and callback flow with route tests (`8d32e02`)
- Priority rules, ordering, manual changes, and tests (`ac67cfe`)
- Sample-data demo views and data design (`97f5a0b`)
- Privacy policy and terms pages (`35b4a00`)
- Serverless-safe Gmail sessions: encrypted tokens stored in the database (`dca63c5`)
- UI redesign after the /demo preview, with new branding and button styles (`cf93171`, `a3d8e86`, `81511cc`, `d5292de`), and layouts for phones (`e92631e`)
- Google Calendar integration: calendar view and event creation after the user approves (`c099a79`)
- AI email insights: summary of an opened message and suggested calendar events, with “Add to Calendar” (`34b0527`)
- Summary view, logout, and dark mode (`2c52b5f`)
- AI drafting for new messages in Compose (`2b226db`); mail search with Gmail’s own query (`12ca12b`)
- Performance: session and connection caching, cached mailbox lists, change checks before reloading, batch loading of Daily Briefing insights (`4f6cd58`, `4570310`, `b2f8d96`, `44d6149`, `13a1a28`, `6cd2cd6`)
- Reliability: retries when Gemini is overloaded (`40c309a`), lists that still load when one message fails (`6d6dea6`), verified database TLS (`028d206`)
- Google profile photo and safe avatar initials (`2f88814`, `650acb7`)

**Partially completed**

- *Nothing partially completed.*

## 2. Group Progress Update

### Planned versus finished

| Use case / feature | Planned by Milestone 4 | Status |
| --- | --- | --- |
| Google login | Yes | Complete |
| All Emails, Starred, Drafts, Trash, Sent views | Yes | Complete |
| Daily Briefing with Urgent / FYI / Low Priority | Yes | Complete (rules for new mail, then AI analysis of the full message) |
| Message actions (read, unread, star, archive, spam, trash, restore, set priority) | Yes | Complete |
| Attachments (view, download, forward) | Not in original schedule | Complete (added) |
| Send reply, reply-all, forward with user confirmation | Yes | Complete |
| Mail search (Gmail search inside each mailbox, with attachment and unread filters) | Not in original schedule | Complete (added) |
| AI reply draft | Yes | Complete |
| AI summary | Yes | Complete |
| Persistent encrypted sessions and managed PostgreSQL | Yes | Complete |
| Online deployment | Yes | Complete: https://cse-416-2026-fall.vercel.app |
| Email-to-Calendar | In progress | Complete (suggest, edit, approve, create) |
| User personalization (About you details in Settings, “Is this for you?” answers, Summary to-do list) | Added for Hardening | Complete |
| Compose, with AI drafting and automatic drafts | Not in original schedule | Complete (added) |
| Phone layout and dark mode | Not in original schedule | Complete (added) |
| Manual tests | Ongoing | Ongoing, together with user feedback |
| Unit tests | Ongoing | 206 tests (`npm test`) |
| Hardening (end-to-end tests, monitoring, rate handling) | Later | Partly complete: privacy review and rate handling are done; end-to-end tests and monitoring remain |

### Are we on track?

We are fully on schedule. The Gmail workflow, the deployment foundation, and AI reply drafting are finished and merged. With complete product, now we are getting user feedbacks and applying those changes. The AI summary and Email-to-Calendar are also complete, so all four core features in the design document work on the deployed site.

### Team grade

We feel our overall progress so far is an **A** because the core email workflow works end to end with real Gmail accounts, including AI reply drafts and sending, and the storage and session design is ready for production. We also added a solid feature of user preference tracking to show the user TODO emails on Summary tab.

### Biggest difficulties so far

- **Sessions on serverless hosting.** The older version kept Google tokens in server memory, which does not survive restarts or multiple instances. We replaced it with encrypted sessions in PostgreSQL.
- **Database change.** We started with local SQLite and had to move to managed PostgreSQL for deployment, which meant rewriting the storage layer and its tests.
- **Google OAuth restrictions.** `gmail.modify` is a restricted scope. In Testing mode only listed test users can log in and authorization expires after seven days.
- **AI cost and rate limits.** We chose the Gemini free tier for API calls, so we had to save the tokens. So we cached drafts in the database so reopening a message does not call the model again.
- **User privacy.** We tried to respect user privacy much as possible, making separation of user data, and managing a separate database for developers to restrict access to the product database.

### Schedule changes and adjustments

- **Earlier delay, now recovered.** The deployment foundation (PostgreSQL and persistent sessions) took longer than planned and had to be finished before AI features could store results. Mail features that were not in the original schedule (attachments, forward, archive, spam, Sent view) also took time. The AI summary and Email-to-Calendar were finished after that, so all four core features are now complete.
- **Features added to the schedule.** Compose, mail search, the Summary to-do list with user personalization, a phone layout, and dark mode were not in the original schedule. They are complete and listed in the table above.
- **Verification.** Each completed feature is verified by the teammate who did not build it, and bugs go to GitHub Issues.
- **Remaining work.** What is left is hardening (end-to-end tests and monitoring), fixing bugs found in verification and from user feedback, and the final documentation.

### Plan for the final release

| Order | Work | Owner |
| --- | --- | --- |
| 1 | Verify the production deployment and OAuth test users | Both |
| 2 | Cross-verification, bug fixing, end-to-end checks, documentation | Both |
| 3 | Get user feedback | Both |
| 4 | Triage GitHub Issues: close the fixed ones, label and assign the open bugs | Both |
