import type { Metadata } from "next";
import Link from "next/link";
import { listForReview, SERVICES } from "@/lib/business";
import { requireStaff } from "@/lib/session";
import { ReviewForm } from "@/components/staff/ReviewForm";
import { signOut } from "@/app/provider/actions";

export const metadata: Metadata = { title: "Provider review" };
export const dynamic = "force-dynamic";

/** Plain working screen for staff. There is no design for this yet. */
export default async function Page() {
  await requireStaff();
  const items = listForReview();
  return (
    <main className="setup">
      <div className="setup__card setup__card--wide">
        <h1 className="auth__title">Providers waiting for review</h1>
        {items.length === 0 ? <p className="auth__subtitle">Nothing is waiting.</p> : null}
        {items.map((b) => (
          <section key={b.id} className="staff__item">
            <h2>{b.name}</h2>
            <dl className="setup__summary">
              <dt>Account email</dt><dd>{b.ownerEmail}</dd>
              <dt>Business email</dt><dd>{b.email}</dd>
              <dt>Phone</dt><dd>{b.phone}</dd>
              <dt>Location</dt><dd>{b.town}, {b.district}</dd>
              <dt>Services</dt><dd>{b.services.map((s) => SERVICES.find((x) => x.id === s)?.label ?? s).join(", ")}</dd>
              {b.description ? (<><dt>About</dt><dd>{b.description}</dd></>) : null}
            </dl>
            <ReviewForm id={b.id} />
          </section>
        ))}
        <p className="auth__footer"><Link href="/staff/outbox">Notification queue</Link></p>
        <form action={signOut} className="setup__signout"><button type="submit" className="resend__button">Sign out</button></form>
      </div>
    </main>
  );
}
