# MailFlow AI — User Manual

MailFlow AI is an email assistant for Gmail. It sorts your mail by priority, summarizes it, lists what still needs you, drafts replies, and turns dates in emails into Google Calendar events. This manual explains how to use it. To set up the code, see the [README](README.md).

**Open the app:** https://cse-416-2026-fall.vercel.app

MailFlow works in a current desktop or phone browser. Nothing is sent and no calendar event is created until you click the button yourself.

## 1. Sign in

1. Open the app and click **Log in with Google**.
2. Choose your Google account and allow access to Gmail and Google Calendar.
3. You arrive on the Daily Briefing.

The app is in beta, so Google only lets accounts on the team's test-user list sign in. If Google refuses your account, ask the team to add your address. Google may also show an "unverified app" notice during the beta.

To sign out, open the account button at the top right and choose **Sign out**.

## 2. Moving around

The dock at the bottom of the screen switches between the pages. From left to right:

| Page | What it shows |
| --- | --- |
| **Daily Briefing** | Today's mail, sorted by priority |
| **Summary** | The emails that still need something from you |
| **Calendar** | Your Google Calendar |
| **Inbox**, **Starred**, **Sent**, **Drafts**, **All Emails**, **Spam**, **Trash** | Your mailboxes |
| **Compose** | Write a new email |

On a phone, the tab bar at the bottom shows four pages, and **More** opens the other mailboxes.

## 3. Daily Briefing

The Daily Briefing shows the mail you received today in three groups: **Urgent**, **FYI**, and **Low Priority**. Each card has the sender, the subject, and a short AI summary. A card also shows when the email contains an event you could add to your calendar.

Click a card to open the email.

## 4. Summary

The Summary page is a to-do list made from your mail. An email appears here when it asks you to do something by a date, or when a person is waiting for your reply.

| Section | Contents |
| --- | --- |
| **Today** | Due today |
| **Next 7 days or more** | Due later |
| **Reply needed** | Someone asked you a question and there is no date |
| **Added by you** | Emails you added yourself |

- Click an item to open the email.
- Click **Done** when you have dealt with it. Finished items stay under **Done recently** for 7 days, where **Undo** brings one back.
- **Is this for you? Yes / No** appears when MailFlow is not sure the email is meant for you. **No** removes the item. MailFlow may remember your answer for similar mail.
- A date marked **Event** is the day of an event in the email, not a deadline.
- An item that only waits for a reply is finished when you send the reply. An item with a date leaves the list after that date has passed.

To add any email to the Summary yourself, open it and click **Add to Summary** in the Email insights panel.

Filling in **About you** in Settings (section 9) helps MailFlow leave out mail meant for other groups.

## 5. Mailboxes

- **Search** by sender, subject, or message text. Gmail search words such as `from:` also work.
- **Has attachment** and **Is unread** narrow the list.
- Unread mail is shown in bold with a dot. Mail you have opened has a gray background.
- Click the star to add an email to **Starred**.
- Tick the checkboxes to act on several emails at once: **Archive**, **Report spam**, **Delete**, and **Mark as read** or **Mark as unread**.
- The label on the right of each row is its priority.

Deleted mail goes to **Trash** and can be restored from there. Gmail removes mail in Trash and Spam after 30 days.

## 6. Reading an email

Open an email to see the message on the left and the AI panel on the right. On a phone the AI panel is above the message, and **AI reply** opens the reply.

**Toolbar:** Archive, Report spam, Delete, and Mark as unread. The arrows move to the newer or older email.

**Priority:** the menu next to the subject shows Urgent, FYI, or Low Priority. Change it if MailFlow chose wrongly; your choice is kept.

**Attachments:** click one to preview it, or download it.

### Email insights

- **At a glance** is a short AI summary of the email.
- **In Summary** shows the to-do for this email, with **Mark done**.
- **Suggested events** lists dates found in the email. Click **Edit & add** to check the title, date, time, and location, then save the event to Google Calendar. **Dismiss** removes a suggestion.

### Suggested reply

MailFlow drafts a reply when you open an email from a person. For automated mail it does not, but **Reply anyway** asks for one.

1. Edit the draft directly in the text box.
2. Move the **Tone** slider (Casual to Formal) and the **Length** slider (Short to Detailed) to get a new draft.
3. Or type a request in **Ask AI to change this reply**, for example "write this in Korean", and click **Apply**.
4. Click **Send reply** when you are satisfied.

When you come back to the email later, the draft and sliders are as you left them.

To write a reply yourself, use **Reply**, **Reply all**, or **Forward** at the bottom of the email. You can format the text and attach files. An unfinished reply is saved to Drafts automatically.

## 7. Writing a new email

1. Click **Compose**.
2. Enter the recipients in **To** (and **Cc Bcc** if needed) and a subject.
3. Write the message. The toolbar formats the text, and the paperclip attaches files (up to 4 MB in total).
4. Optional: click **Write with AI**, describe what the email should say, choose a tone and length, and let MailFlow write it. Read the result before sending.
5. Click **Send**.

A message you have not sent is saved to **Drafts** automatically. Open it from Drafts to continue.

## 8. Calendar

The Calendar page shows your Google Calendar. Pick a day to see its events, or click **New event** to add one. Events you add from an email appear here and in Google Calendar.

If the page says calendar access is required, sign in again and allow access to Google Calendar.

## 9. Settings

Open the account button at the top right and choose **Settings**.

- **Appearance:** light or dark.
- **About you** (optional): your role, organization, topics you care about, and anything else. MailFlow uses these only to decide whether an email is meant for you, and never changes them itself.
- **Personalization history:** what MailFlow remembered from your "Is this for you?" answers. You can remove any entry.
- **Delete profile and personalization history:** removes your About you details and the history together. This cannot be undone.

## 10. Good to know

- **AI can be wrong.** Summaries, priorities, suggested events, and reply drafts are suggestions. Check the original email before you rely on one.
- **You stay in control.** MailFlow sends an email or creates a calendar event only when you click the button.
- **Your mail stays in Gmail.** Changes you make here (read, star, archive, delete, drafts) appear in Gmail too.
- **Privacy:** see the [Privacy Policy](https://cse-416-2026-fall.vercel.app/privacy) and [Terms](https://cse-416-2026-fall.vercel.app/terms).

## 11. Problems

| Problem | What to try |
| --- | --- |
| Google refuses the sign-in | Your account is not on the beta test-user list. Ask the team to add it. |
| You are asked to sign in again | The beta sign-in expires after 7 days. Sign in again. |
| A summary or reply does not appear | The AI service may be busy. Wait a moment and reopen the email. |
| A page will not load | Reload the page. If it continues, report it. |

To report a bug, open https://github.com/Donghyun-glt/cse-416-2026-fall/issues, click **New issue**, and describe what you did, what you expected, and what happened. Do not paste email contents or passwords.
