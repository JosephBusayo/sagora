import type { Metadata } from "next";
import Image from "next/image";
import { DISTRICTS, SERVICES, ensureBusiness, type BusinessStatus } from "@/lib/business";
import { requireProvider } from "@/lib/session";
import { SetupForm } from "@/components/setup/SetupForm";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Set up your business" };

// Specific states, never a vague "Pending" (brief rule).
const STATUS: Record<Exclude<BusinessStatus, "draft">, { title: string; body: string }> = {
  submitted: {
    title: "Waiting for Sagora to review your business",
    body: "We have your details. A Sagora coordinator will check them and email you the result. You can't edit while the review is open.",
  },
  changes_requested: {
    title: "Sagora needs a few changes",
    body: "Update your details below and submit again.",
  },
  approved: {
    title: "Your business is approved",
    body: "You can now receive requests. Your workspace is the next thing we are building.",
  },
  rejected: {
    title: "We couldn't approve your business",
    body: "See the reason below. If you think this is a mistake, contact Sagora.",
  },
};

export default async function Page() {
  const user = await requireProvider();
  const b = ensureBusiness(user);
  const editable = b.status === "draft" || b.status === "changes_requested";
  const info = b.status === "draft" ? null : STATUS[b.status];

  return (
    <main className="setup">
      <div className="setup__card">
        <Image src="/brand/logo-mark.png" alt="Sagora" width={70} height={65} />
        <h1 className="auth__title setup__title">{editable ? "Set up your business" : b.name}</h1>
        {b.status === "draft" ? (
          <p className="auth__subtitle">Tell us about your business. Sagora reviews it before you can receive requests.</p>
        ) : null}

        {info ? (
          <section className={`setup__status setup__status--${b.status}`} aria-live="polite">
            <h2>{info.title}</h2>
            <p>{info.body}</p>
            {b.reviewNote ? <p className="setup__note"><strong>Note from Sagora:</strong> {b.reviewNote}</p> : null}
          </section>
        ) : null}

        {editable ? (
          <SetupForm
            initial={{ name: b.name, phone: b.phone, email: b.email, district: b.district, town: b.town, services: b.services, description: b.description }}
            districts={DISTRICTS}
            services={SERVICES}
          />
        ) : (
          <dl className="setup__summary">
            <dt>Phone</dt><dd>{b.phone}</dd>
            <dt>Email</dt><dd>{b.email}</dd>
            <dt>Location</dt><dd>{b.town}, {b.district}</dd>
            <dt>Services</dt><dd>{b.services.map((s) => SERVICES.find((x) => x.id === s)?.label ?? s).join(", ")}</dd>
            {b.description ? (<><dt>About</dt><dd>{b.description}</dd></>) : null}
          </dl>
        )}

        <form action={signOut} className="setup__signout">
          <button type="submit" className="resend__button">Sign out</button>
        </form>
      </div>
    </main>
  );
}
