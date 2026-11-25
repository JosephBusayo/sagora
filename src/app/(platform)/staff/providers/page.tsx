import { PageHead } from "@/components/app/Shell";
import { EmptyState } from "@/components/app/EmptyState";
import { StaffShell } from "@/components/staff/StaffShell";
import type { Metadata } from "next";
import { BUSINESS_TYPES, PRICING_BASES, districtLabel, listForReview, optionLabel, SERVICES } from "@/lib/business";
import { byDistrict, pendingChanges, type Area } from "@/lib/coverage";
import { PendingButton } from "@/components/app/PendingButton";
import { decideAreasAction, reviewEquipmentAction } from "../actions";
import { describeSpecs } from "@/lib/specs";
import { equipmentAwaitingReview } from "@/lib/equipment";
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
  // Equipment a provider registered that nobody has checked yet. Its own queue on this page
  // rather than buried inside each provider's profile: a machine submitted today by a provider
  // approved months ago would otherwise never be looked at.
  const machines = await equipmentAwaitingReview();
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
        {machines.length > 0 ? (
          <section className="staff__item" aria-labelledby="equipment-review">
            <h2 id="equipment-review">Equipment waiting for approval</h2>
            <p className="field__helper">
              A provider registered these. They are saved on the provider&rsquo;s own register but cannot be
              put on a farmer&rsquo;s work until somebody here has checked them.
            </p>
            <ul className="asset__faults">
              {machines.map((m) => (
                <li key={m.equipmentId} className="coverage-change">
                  <span className="asset__fault-text">
                    <strong>{m.businessName}</strong> registered <strong>{m.name}</strong>
                    <br />
                    <span className="field__helper">
                      {[m.kindLabel,
                        m.identifier ? `serial ${m.identifier}` : "no serial given",
                        m.services.length ? `for ${serviceNames(m.services)}` : null,
                        describeSpecs(m.kind, m.specs).map((x) => `${x.label}: ${x.value}`).join(", ") || null,
                        m.hasPhoto ? "photo attached" : "no photo",
                        `submitted ${m.submittedAt.slice(0, 10)}`,
                      ].filter(Boolean).join(" · ")}
                    </span>
                    {m.notes ? <><br /><span className="field__helper">{m.notes}</span></> : null}
                  </span>
                  {/* Rejecting asks for a reason in the same breath: the provider has to be able to
                      put it right, and "no" on its own sends them to the phone. */}
                  <form action={reviewEquipmentAction} className="coverage-change__actions equipment-review__form">
                    <input type="hidden" name="equipmentId" value={m.equipmentId} />
                    <label className="field__label" htmlFor={`note-${m.equipmentId}`}>Reason, if you are rejecting it</label>
                    <input id={`note-${m.equipmentId}`} name="note" className="field__input" maxLength={300}
                      placeholder="eg: the serial in the photo does not match the one typed in" />
                    <span className="coverage-change__actions">
                      <PendingButton name="decision" value="reject" className="button button--soft button--inline">Reject</PendingButton>
                      <PendingButton name="decision" value="approve" className="button button--inline">Approve</PendingButton>
                    </span>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {items.length === 0 && changes.length === 0 && machines.length === 0 ? <div className="table-card"><EmptyState icon="store" title="Nothing is waiting" body="New businesses appear here when they submit for review." /></div> : null}
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
