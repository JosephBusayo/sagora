import type { Metadata } from "next";
import Link from "next/link";
import { whatsappLink } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Privacy policy · Sagora",
  description: "What Sagora collects, why, who it is shared with, and how to ask for a copy or have it deleted.",
};

/** Set SAGORA_PRIVACY_EMAIL to the address that answers privacy requests. */
const privacyEmail = () => process.env.SAGORA_PRIVACY_EMAIL?.trim();

const UPDATED = "16 November 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="legal__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Written from what the code actually does, not from a template: every item below is something
 * the database really stores or a service the app really calls. Both app stores require a policy
 * at a public address before a listing can be submitted.
 */
export default function Page() {
  const email = privacyEmail();
  const whatsapp = whatsappLink("Hello Sagora, I have a question about my personal information.");

  return (
    <main className="legal">
      <Link href="/" className="legal__back">← Back to Sagora</Link>
      <h1>Privacy policy</h1>
      <p className="legal__updated">Last updated {UPDATED}</p>

      <p className="legal__lead">
        Sagora connects farmers in Sierra Leone with people who plough, plant and harvest. To do that we
        have to hold some information about you. This page says exactly what we hold, why, and how to
        get a copy of it or have it removed.
      </p>

      <Section title="What we collect">
        <p>Only what the service needs to work:</p>
        <ul>
          <li><strong>Your account</strong> — your name, email address, phone number, and a password we store scrambled so nobody at Sagora can read it.</li>
          <li><strong>Your requests</strong> — the work you need, the size of the land, the crop, the district, chiefdom and village, the dates you want, and any notes you add. If you send a request without an account, we keep the name and phone number you give us so a provider can reach you.</li>
          <li><strong>Service providers</strong> — business name and contact details, the districts and services you cover, your equipment, your team, and the identity or registration documents you upload for review.</li>
          <li><strong>Payments</strong> — what was paid, when, and against which job. Card and mobile-money details are entered on our payment provider&apos;s own page and are never seen or stored by Sagora.</li>
          <li><strong>Voice notes</strong> — if you describe a request by speaking instead of filling a form, we keep the written transcript and the details taken from it. <strong>The recording itself is not kept</strong> once it has been read.</li>
          <li><strong>The phone app</strong> — if you allow notifications, a code identifying your phone, so we can tell you when a quote arrives. It does not identify you to anyone else and is deleted when it stops working.</li>
        </ul>
      </Section>

      <Section title="Why we hold it">
        <p>
          To show your request to providers who work in your district, to let them quote for it, to arrange
          and run the job, to take and record payment, and to tell you when something happens. We also keep
          a record of money in and out because that is what running payments honestly requires.
        </p>
        <p>We do not sell your information, and we do not use it for advertising.</p>
      </Section>

      <Section title="Who else sees it">
        <ul>
          <li><strong>Service providers</strong> see the request itself — the work, the land, the place and the dates — and your name and phone number once you are working together, so they can find the farm and call you.</li>
          <li><strong>Sagora staff</strong> see what they need to review providers, help with a request taken over the phone, and settle payments.</li>
          <li><strong>Companies that run parts of the service for us</strong>: Monime for payments, Resend for email, Google for turning voice notes into text and for sending notifications to the app, and Neon and Vercel for storing and serving the site. They may only use it to do that job for us.</li>
        </ul>
        <p>We share information with anyone else only if the law requires it.</p>
      </Section>

      <Section title="How long we keep it">
        <ul>
          <li><strong>Identity and registration documents</strong> uploaded by providers are deleted six months after they are uploaded.</li>
          <li><strong>Your account and your requests</strong> stay while your account is open. Ask us to close it and we remove what we are not required to keep.</li>
          <li><strong>Payment records</strong> are kept longer, because a record of money received and paid out has to be kept.</li>
        </ul>
      </Section>

      <Section title="What you can ask for">
        <p>You can ask us to:</p>
        <ul>
          <li>tell you what we hold about you, and give you a copy;</li>
          <li>correct anything that is wrong;</li>
          <li>delete your account and the information that goes with it;</li>
          <li>stop sending you notifications — you can also turn these off in your phone&apos;s settings.</li>
        </ul>
        <p>We will answer within 30 days. There is no charge.</p>
      </Section>

      <Section title="Keeping it safe">
        <p>
          Information travels to and from Sagora over an encrypted connection, passwords are stored
          scrambled, and staff accounts need a code sent by email on top of a password. No system is
          perfect, and we will tell you if something happens that puts your information at risk.
        </p>
      </Section>

      <Section title="Children">
        <p>Sagora is for adults doing business. We do not knowingly collect information about children under 18.</p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes we will update this page and the date at the top. If the change matters to
          you, we will tell you directly.
        </p>
      </Section>

      <Section title="Contact us">
        {email || whatsapp ? (
          <>
            <p>To ask for a copy of your information, to correct it, or to have it deleted:</p>
            <ul>
              {email ? <li>Email <a href={`mailto:${email}`}>{email}</a></li> : null}
              {whatsapp ? <li>Message us on <a href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a></li> : null}
            </ul>
          </>
        ) : (
          <p>Contact details are being set up and will appear here shortly.</p>
        )}
      </Section>
    </main>
  );
}
