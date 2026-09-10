# MailFlow AI // Donghyun | Seunghoon

MailFlow AI is a simple email assistant that reduces repetitive work by organizing incoming emails and generating personalized replies.

## Main Features

1. Daily Briefing

Collects emails received today

Summarizes important information

Sorts emails into categories such as Urgent, FYI, and Low Priority

2. All Emails

Displays emails imported directly from Gmail

Provides a clean and simple inbox interface

Allows users to quickly find and open an email

3. AI Summary and Reply

When the user opens an email, MailFlow AI provides:

A short AI-generated summary

An AI-generated reply

An editable reply before sending

What Makes It Different?

Minimal UI: Only the essential information and actions are displayed.

Reply controls: Horizontal sliders let users adjust the reply's tone and length.

Tone: Friendly ↔ Professional

Length: Short ↔ Detailed

Personalized writing style: The optional personalization feature analyzes previously sent emails and reflects the user's writing style in future replies.

Gmail Integration

The application connects to Gmail through the Gmail API and Google OAuth 2.0. Users sign in with Google and grant permission before the application reads emails or creates replies.

For safety, AI-generated replies are shown as drafts and require user confirmation before they are sent.

Suggested Tech Stack

Frontend: React, Vite, CSS

Backend: FastAPI

AI: OpenAI API

Email: Gmail API and Google OAuth 2.0

Database: PostgreSQL or SQLite

Basic Workflow

Sign in with Google.

Import emails from Gmail.

Classify and summarize today's emails.

Select an email to view its AI summary.

Adjust the reply tone and length.

Review, edit, and send the reply.

Planned Pages

Daily Briefing  ->  All Emails  ->  Email Detail
                                      |- AI Summary
                                      |- AI Reply
                                      |- Tone Slider
                                      `- Length Slider

Future Improvements

Learn the user's writing style from sent emails

Improve priority classification

Support multiple Gmail accounts

Add reply scheduling

Provide Korean and English replies

Project Goal

The goal of MailFlow AI is to make email management faster and easier while keeping the user in control of every reply.

