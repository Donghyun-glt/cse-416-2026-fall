import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | MailFlow AI",
};

export default function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <section>
        <p>
          MailFlow AI (&quot;MailFlow&quot;, &quot;we&quot;) is a Gmail client built as a student project for
          CSE 416 at Stony Brook University. It helps you review today&apos;s inbox by sorting messages into
          Urgent, FYI and Low Priority. This policy explains what data MailFlow accesses when you sign in with
          Google, how that data is used, and how you can remove it.
        </p>
      </section>

      <section>
        <h2>Google user data we access</h2>
        <p>When you sign in with Google, you grant MailFlow the following permissions:</p>
        <ul>
          <li><strong>Basic profile</strong> (openid, email, profile): your email address and display name, used to identify your account.</li>
          <li>
            <strong>Gmail read and modify</strong> (<code>gmail.modify</code>): MailFlow reads your messages
            (sender, recipients, subject, date, body and labels) to display them and to classify their priority.
            MailFlow changes your mailbox only when you ask it to: marking a message as read, starring or unstarring
            it, and moving it to or restoring it from Trash. MailFlow priority categories are stored in MailFlow&apos;s
            database and are not applied to your Gmail messages as labels.
          </li>
          <li><strong>Calendar events</strong> (<code>calendar.events</code>): MailFlow reads your primary calendar and creates events only after you review and save them.</li>
        </ul>
        <p>MailFlow sends email only when you choose Send and never permanently deletes your messages.</p>
      </section>

      <section>
        <h2>How we use your data</h2>
        <ul>
          <li>Message content is processed to display your mail, classify priority, suggest replies, and identify possible appointments or deadlines.</li>
          <li>When AI features run, relevant message content is sent to Google Gemini to generate reply drafts, identify important instructions, and suggest calendar events. Opening an eligible received message starts content analysis; generated analysis can be kept temporarily in server memory for up to 10 minutes. Suggestions do not send mail or create calendar events until you approve the action.</li>
          <li>We do not use your data for advertising, sell it, or use it to train AI models.</li>
          <li>No person reads your messages, unless you explicitly ask us to for support, it is needed for security purposes, or the law requires it.</li>
        </ul>
      </section>

      <section>
        <h2>What we store</h2>
        <ul>
          <li><strong>Account record:</strong> your email address and display name.</li>
          <li>
            <strong>Priority records:</strong> Gmail message IDs, the priority assigned to each message, whether you or the
            automatic rules assigned it, a short fixed explanation (for example, &quot;A direct request includes
            time-sensitive language&quot;), and a history of priority changes.
          </li>
          <li>
            <strong>AI results for your messages:</strong> for each message MailFlow analyses, the AI-written summary, the
            suggested calendar events with the short quotes from the email that support them, and what you last did with
            each suggestion (your edits, added or dismissed); and the reply draft you last left for a message. These are
            kept so they stay the same each time you open the message, on any device.
          </li>
          <li>
            <strong>About you (optional):</strong> the role, organization, topics and note you choose to
            enter in Settings. Only you can add, change or clear them; MailFlow never fills them in or edits them. They are
            sent to the AI provider together with a message when it is analysed, to judge whether the message concerns you.
          </li>
          <li>
            <strong>Summary items:</strong> for messages that need something from you, a one-line description of the task, its
            deadline if the email states one, and whether you marked it done. When MailFlow is unsure a message concerns
            you, it also keeps how the email describes its audience and kind, so it can ask you.
          </li>
          <li>
            <strong>Your &quot;Is this for you?&quot; answers:</strong> when you answer that question on the Summary tab,
            MailFlow may remember your yes or no together with that audience or kind of mail (for example, &quot;No: mail
            for TSM majors&quot;), so it does not ask again. Usually nothing is kept. These never change your About-you
            details, they are sent to the AI provider like those details, and you can see and remove them in Settings.
          </li>
          <li><strong>Sign-in session:</strong> the OAuth tokens Google issues, encrypted in our database and used to make Gmail and Google Calendar requests for you, together with an opaque session cookie in your browser that lasts up to 7 days.</li>
        </ul>
        <p>
          The content listed above (AI summaries and suggested events, reply drafts, your edits, your About-you answers,
          task descriptions and remembered Summary answers) is encrypted before it is stored, with a key that is kept outside the database and is
          different for every account. People who can read the database, including MailFlow&apos;s developers, see only
          ciphertext for it. Your email address, Gmail message IDs, priority labels, dates and done/not-done states are
          stored unencrypted so the app can look them up.
        </p>
        <p>
          We do not store full message bodies or attachments. Messages are fetched from Gmail when you open the
          app and are not kept afterwards, apart from the AI results listed above. Calendar events are fetched when you open the Calendar screen and are not stored in our database.
        </p>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>
          Google Gemini processes relevant message content for AI features. Our hosting and database providers
          process data on our behalf to run the service. We do not sell your Google user data.
        </p>
      </section>

      <section>
        <h2>Limited Use disclosure</h2>
        <p>
          MailFlow AI&apos;s use and transfer of information received from Google APIs to any other app will adhere to
          the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <ul>
          <li>
            You can revoke MailFlow&apos;s access at any time from your{" "}
            <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google Account connections</a>{" "}
            page. MailFlow can no longer access your Gmail after that.
          </li>
          <li>
            To delete your account record and priority records, email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will delete them within 30 days.
          </li>
        </ul>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          All traffic is encrypted with HTTPS. Session cookies are HTTP-only, and credentials are stored only on
          the server.
        </p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          If we change this policy, we will update the effective date on this page. For any questions, contact{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
