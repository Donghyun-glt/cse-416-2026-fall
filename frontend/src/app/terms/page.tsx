import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Service | MailFlow AI",
};

export default function TermsOfService() {
  return (
    <LegalPage title="Terms of Service">
      <section>
        <p>
          These terms apply when you use MailFlow AI (&quot;MailFlow&quot;, &quot;we&quot;), a Gmail client built as a
          student project for CSE 416 at Stony Brook University. By signing in, you agree to these terms. If you do
          not agree, do not use the service.
        </p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          MailFlow shows the messages in your Gmail inbox and sorts them by priority. It can also mark messages as
          read, star them, move them to Trash, restore them from Trash, and apply MailFlow priority labels. MailFlow
          takes these actions only when you request them in the app or when it applies priority labels.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>You need a Google account. You may only connect a Gmail account that you own or are authorized to use.</li>
          <li>You are responsible for the actions you take in MailFlow on your own mailbox.</li>
          <li>You can stop using MailFlow and revoke its access at any time, as described in the <Link href="/privacy">Privacy Policy</Link>.</li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not misuse the service. For example, do not try to access other users&apos; data, overload or disrupt
          the service, or use it to break any law or Google&apos;s terms.
        </p>
      </section>

      <section>
        <h2>Student project disclaimer</h2>
        <p>
          MailFlow is an academic project. It is provided &quot;as is&quot; without warranties of any kind, and it may
          change, break or stop working at any time. Automatic priority labels may be wrong, so do not rely on them
          for important decisions. To the extent permitted by law, we are not liable for lost or missed email or any
          other damage that results from using the service.
        </p>
      </section>

      <section>
        <h2>Privacy</h2>
        <p>
          The <Link href="/privacy">Privacy Policy</Link> explains how we handle your data.
        </p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          We may update these terms and will change the effective date when we do. If you keep using MailFlow after
          a change, you accept the updated terms. For any questions, contact{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
