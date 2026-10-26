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
            MailFlow also changes your mailbox only when the app needs to or when you ask it to: marking a message as
            read, starring or unstarring it, moving it to or restoring it from Trash, and creating and applying the
            labels <code>MailFlow/Urgent</code>, <code>MailFlow/FYI</code> and <code>MailFlow/Low Priority</code>.
          </li>
        </ul>
        <p>MailFlow never sends email on your behalf and never permanently deletes your messages.</p>
      </section>

      <section>
        <h2>How we use your data</h2>
        <ul>
          <li>Message content is processed only to show it to you and to compute a priority with rules that run on our server.</li>
          <li>Message content is not sent to any third-party service, including AI or machine learning providers.</li>
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
          <li><strong>Sign-in session:</strong> the OAuth tokens Google issues, used only to make Gmail requests for you, together with a session cookie in your browser that lasts up to 7 days.</li>
        </ul>
        <p>
          We do not store message subjects, bodies or attachments. Messages are fetched from Gmail when you open the
          app and are not kept afterwards.
        </p>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>
          We do not share your Google user data with third parties. Our hosting and database providers
          store this data on our behalf only to run the service.
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
          <li>The <code>MailFlow/*</code> labels stay in your Gmail until you delete them in Gmail.</li>
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
