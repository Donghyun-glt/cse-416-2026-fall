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
```
Next.js Frontend
 ├─ Daily Briefing
 ├─ Inbox / Email Detail
 ├─ Reply Editor + Tone/Length sliders
 └─ Calendar Event Preview

NestJS Backend
 ├─ Auth Module (Google OAuth)
 ├─ Gmail Module
 ├─ AI Module (summary, priority, reply, date extraction)
 ├─ Calendar Module
 └─ User / Draft / Approval Module
 ```

## Run locally

```bash
npm --prefix frontend install
npm run dev
```

Open http://localhost:3000. Google sign-in also requires the OAuth settings described in [frontend/README.md](frontend/README.md).

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
