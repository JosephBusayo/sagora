import { PageHead } from "@/components/app/Shell";
import { EmptyState } from "@/components/app/EmptyState";
import { StaffShell } from "@/components/staff/StaffShell";
import type { Metadata } from "next";
import { BUSINESS_TYPES, PRICING_BASES, districtLabel, listForReview, optionLabel, SERVICES } from "@/lib/business";
import { byDistrict, pendingChanges, type Area } from "@/lib/coverage";
import { PendingButton } from "@/components/app/PendingButton";
import { decideAreasAction } from "../actions";
import { documentKindLabel, listDocuments } from "@/lib/business-documents";
import { requireStaff } from "@/lib/session";
import { ReviewForm } from "@/components/staff/ReviewForm";

export const metadata: Metadata = { title: "Provider review" };
export const dynamic = "force-dynamic";

const serviceNames = (ids: string[]) => ids.map((s) => SERVICES.find((x) => x.id === s)?.label ?? s).join(", ");
const where = (areas: Area[]) => byDistrict(areas).map((d) => `${districtLabel(d.district)}: ${serviceNames(d.services)}`).join(" · ");

/** Staff screen, in the same frame as the apps. There is no design for this page itself. */
export default async function Page() {
  const staff = await requireStaff();
  const items = await Promise.all((await listForReview()).map(async (b) => ({ ...b, docs: await listDocuments(b.id) })));
  const changes = await pendingChanges();
  return (
    <StaffShell staff={staff} crumb={{ label: "Provider review", icon: "store" }}>
        <PageHead title="Providers waiting for review" />
        {changes.length > 0 ? (
          <section className="staff__item" aria-labelledby="coverage-changes">
            <h2 id="coverage-changes">New districts and services to check</h2>
            <p className="field__helper">An approved provider asked to take requests somewhere new. Requests from there only reach them once you approve.</p>
            <ul className="asset__faults">
              {changes.map((c) => (
                <li key={c.businessId} className="coverage-change">
                  <span className="asset__fault-text">
                    <strong>{c.name}</strong> asks to add {where(c.areas)}
                    {c.current.length ? <><br /><span className="field__helper">Works now in {where(c.current)}</span></> : null}
                  </span>
                  <span className="coverage-change__actions">
                    <form action={decideAreasAction}>
                      <input type="hidden" name="businessId" value={c.businessId} />
                      <input type="hidden" name="decision" value="decline" />
                      <PendingButton className="button button--soft button--inline" confirm={`Decline for ${c.name}?`}
                        confirmBody="They keep the districts they already have." confirmAction="Decline">Decline</PendingButton>
                    </form>
                    <form action={decideAreasAction}>
                      <input type="hidden" name="businessId" value={c.businessId} />
                      <input type="hidden" name="decision" value="approve" />
                      <PendingButton className="button button--inline">Approve</PendingButton>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
              <dt>Kind of business</dt><dd>{optionLabel(BUSINESS_TYPES, b.businessType)}</dd>
              <dt>Person in charge</dt><dd>{b.authorisedName ? `${b.authorisedName}, ${b.authorisedRole}` : "Not given"}</dd>
              <dt>Prices</dt><dd>{optionLabel(PRICING_BASES, b.pricingBasis)}{b.includedCosts ? `. Includes: ${b.includedCosts}` : ""}</dd>
              <dt>Deposit</dt><dd>{b.depositTerms || "Not given"}</dd>
              <dt>Cancellation</dt><dd>{b.cancellationTerms || "Not given"}</dd>
              <dt>Documents</dt>
              <dd>
                {b.docs.length ? (
                  <ul className="doc-list">
                    {b.docs.map((d) => <li key={d.id}><a href={`/staff/providers/document/${d.id}`} target="_blank" rel="noopener">{documentKindLabel(d.kind)}: {d.fileName}</a></li>)}
                  </ul>
                ) : "None"}
              </dd>
            </dl>
            <ReviewForm id={b.id} />
          </section>
        ))}
    </StaffShell>
  );
}
