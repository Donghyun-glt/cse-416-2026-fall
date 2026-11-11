# ✉️ MailFlow AI

> A simpler way to understand, organize, and respond to email.

**CSE 416 · Fall 2026**  
**Team:** Donghyun Lim · Seunghoon Jang

---

## Overview

**MailFlow AI** is a focused email assistant that reduces repetitive work. It organizes incoming Gmail messages, summarizes their important points, drafts personalized replies, and turns dates found in emails into Google Calendar events.

## Problem & Solution

People spend too much time sorting crowded inboxes, finding important information, and writing repetitive replies. As a result, urgent messages and deadlines can easily be overlooked. MailFlow AI solves this problem by prioritizing and summarizing emails, drafting replies, and converting detected dates into suggested Google Calendar events. The user reviews and approves every reply and calendar event before any action is taken.

<div align="center">

## Follow Our Development Progress

<a href="https://stonybrook-team-ez6z21om.atlassian.net/jira/software/projects/SCRUM/boards/1/backlog?atlOrigin=eyJpIjoiMTE4MWJjNmUyMmU0NGJkZThhM2FjYWI4Y2ZiN2Y2MWYiLCJwIjoiaiJ9">
  <img src="https://img.shields.io/badge/OPEN_THE_JIRA_BOARD-0052CC?style=for-the-badge&logo=jira&logoColor=white" alt="Open the MailFlow AI Jira Board">
</a>

**View our backlog, active sprint, task ownership, and project status.**

</div>

---

## Core Features

### 1. Daily Briefing

- Collects emails received today.
- Summarizes the most important information.
- Sorts messages into **Urgent**, **FYI**, and **Low Priority**.
- Helps users understand what needs attention at a glance.

### 2. All Emails

- Imports messages directly from Gmail.
- Presents them in a clean, minimal inbox.
- Clearly displays each email's priority category.
- Lets users quickly find and open a message.

### 3. AI Summary and Reply

When the user opens an email, MailFlow AI provides:

- A short AI-generated summary.
- A suggested reply based on the email's context.
- An editable draft that must be reviewed before sending.
- Controls for adjusting the reply's tone and length.

### 4. Email-to-Calendar

- Detects important dates, deadlines, appointments, and meetings in incoming emails.
- Extracts useful event details such as the title, date, time, and location.
- Shows a preview so the user can verify or edit the information.
- Adds the approved event to **Google Calendar**.

## Tech Stack

MailFlow AI is one Next.js application: the React interface and the backend API routes live in the same codebase under `frontend/`. The earlier plan for a separate NestJS backend was dropped, as recorded in the Software Design Document.

| Layer | Choice |
| --- | --- |
| Interface | React 19, Tailwind CSS 4 |
| Application framework and backend API | Next.js 16 route handlers, TypeScript |
| Runtime | Node.js 22 LTS |
| Database | PostgreSQL (managed, e.g. Neon) through `pg` |
| Google integration | `googleapis` (OAuth 2.0, Gmail API v1) |
| AI | Google Gemini API (`gemini-3.5-flash-lite` by default) |
| Hosting | Vercel |

## Live Beta

<!-- TODO(team): paste the production URL here once the Vercel deployment is verified. -->
Deployed on Vercel: **URL to be added**

## Developer Setup

These instructions are written for **Windows 10/11 (PowerShell)** and **macOS / Linux (bash or zsh)**. The commands are the same on every system unless a step shows two variants.

### Prerequisites

- [Node.js 22 LTS](https://nodejs.org/) (includes npm 10) and Git
- A PostgreSQL database. A free [Neon](https://neon.tech/) project is the simplest option; a local PostgreSQL 17 server also works.
- A Google Cloud project with the Gmail API enabled and a web OAuth client. See [frontend/README.md](frontend/README.md) for the step-by-step setup.
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com) (the free tier is enough).

Team members can ask a teammate for the shared development credentials instead of creating new ones.

### 1. Check out the source

`main` is the stable branch. Features are merged into it only after they work.

```bash
git clone https://github.com/Donghyun-glt/cse-416-2026-fall.git
cd cse-416-2026-fall
git checkout main
git pull
```

### 2. Install dependencies

```bash
npm --prefix frontend install
```

### 3. Configure environment variables

Copy the example file, then fill it in.

```powershell
# Windows (PowerShell)
Copy-Item .env.example frontend\.env.local
```

```bash
# macOS / Linux
cp .env.example frontend/.env.local
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth web client |
| `GOOGLE_REDIRECT_URI` | Yes | `http://localhost:3000/api/google/callback` for local development. It must also be registered in the Google Cloud console. |
| `DATABASE_URL` | Yes | PostgreSQL connection string, e.g. `postgresql://user:password@host/database?sslmode=require` |
| `SESSION_SECRET` | Yes | Long random value used to encrypt stored Google tokens |
| `GEMINI_API_KEY` | Yes, for AI replies | Gemini API key |
| `GEMINI_MODEL` | No | Overrides the default model |
| `DATABASE_POOL_MAX` | No | Connection-pool limit (default 5) |

Generate a `SESSION_SECRET` on any system with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Never commit `frontend/.env.local`; it is ignored by Git.

### 4. Set up the database

Create an empty PostgreSQL database (in Neon: create a project and copy its connection string into `DATABASE_URL`). Then apply the migrations in `frontend/db/migrations/`:

```bash
cd frontend
node --env-file=.env.local scripts/migrate-db.mjs
cd ..
```

The script is safe to run again; it skips migrations that are already applied. To inspect stored classifications later, run `node --env-file=.env.local scripts/inspect-db.mjs` from `frontend/`.

### 5. Build

```bash
npm --prefix frontend run build
```

### 6. Run locally

```bash
npm run dev
```

Open http://localhost:3000 and click **Log in with Google**. Use `localhost`, not the LAN IP that Next.js prints, because the OAuth callback must return to the origin that started the login. While the Google app is in Testing mode, your Google account must be on the OAuth test-user list.

To run the production build instead of the dev server: `npm --prefix frontend run start`.

### 7. Test

```bash
npm --prefix frontend test
npm --prefix frontend run lint
```

`npm test` runs the unit tests in `frontend/tests/` with the Node.js test runner. They use mocked Google and database services, so they need no credentials and no running database. Run the tests, the linter, and the build before pushing to `main`.

To check the full flow by hand: log in, open the Daily Briefing, open a message, generate a reply draft, and send a reply to yourself.

## Bugs and Issues

We track bugs with **GitHub Issues**: https://github.com/Donghyun-glt/cse-416-2026-fall/issues

- **See outstanding bugs:** open the link above; open issues with the `bug` label are the current known bugs.
- **Report a bug:** click **New issue** and include what you did, what you expected, what happened, your browser and operating system, and a screenshot if it helps. Do not paste email contents or credentials.
- Serious bugs are assigned to a team member and scheduled on the Jira board.

## Documentation

- [Backend API](Documents/API_Design/API.md)
- [Software Design Document](Documents/Software_design/MailFlowAI-SoftwareDesign.docx)
- [Data Design](Documents/Data_Design/MailFlowAI-DataDesign.docx)
- [Milestone 4 Progress Update](Documents/Milestone4/Milestone4_Progress_Update.md)
- Schedule: the Jira board linked above

### Sample-data preview

http://localhost:3000/demo shows the interactive UI draft from the Data Design + Web Views assignment. It uses fixed sample data, does not call Gmail or Google Calendar, and its confirmation buttons perform no external action.

## What Makes It Different?

| Feature | What it provides |
| --- | --- |
| **Minimal interface** | Displays only the information and actions the user needs. |
| **Flexible reply controls** | Horizontal sliders adjust tone from **Friendly → Professional** and length from **Short → Detailed**. |
| **Personalized writing style** | Optionally learns patterns from previously sent emails and reflects the user's style in future drafts. |
| **Calendar awareness** | Recognizes dates and schedules in email, then prepares a Google Calendar event instead of making the user enter it manually. |
| **Human approval** | Keeps replies and calendar events as suggestions until the user reviews and confirms them. |

## Future Improvements

- Improve personalized writing-style adaptation.
- Improve priority and intent classification.
- Support multiple Gmail accounts.
- Add reply scheduling.
- Provide Korean and English replies.

## Project Goal

MailFlow AI aims to make email management faster and less repetitive while ensuring that users retain control over every message sent and every calendar event created.

## Project Links

### [Open the MailFlow AI Jira Board](https://stonybrook-team-ez6z21om.atlassian.net/jira/software/projects/SCRUM/boards/1/backlog?atlOrigin=eyJpIjoiMTE4MWJjNmUyMmU0NGJkZThhM2FjYWI4Y2ZiN2Y2MWYiLCJwIjoiaiJ9)

Use the Jira board to review our current sprint, upcoming work, individual responsibilities, and development progress.
