import { PageHead } from "@/components/app/Shell";
import { EmptyState } from "@/components/app/EmptyState";
import { StaffShell } from "@/components/staff/StaffShell";
import type { Metadata } from "next";
import { listForReview, SERVICES } from "@/lib/business";
import { requireStaff } from "@/lib/session";
import { ReviewForm } from "@/components/staff/ReviewForm";

export const metadata: Metadata = { title: "Provider review" };
export const dynamic = "force-dynamic";

/** Staff screen, in the same frame as the apps. There is no design for this page itself. */
export default async function Page() {
  const staff = await requireStaff();
  const items = await listForReview();
  return (
    <StaffShell staff={staff} crumb={{ label: "Provider review", icon: "store" }}>
        <PageHead title="Providers waiting for review" />
        {items.length === 0 ? <div className="table-card"><EmptyState icon="store" title="Nothing is waiting" body="New businesses appear here when they submit for review." /></div> : null}
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
    </StaffShell>
  );
}
