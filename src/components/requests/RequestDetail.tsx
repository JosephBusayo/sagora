import { inspectionsForRequest } from "@/lib/inspections";
import { kindLabel } from "@/lib/equipment";
import { acceptInspectionAction, proposeInspectionAction } from "@/app/(platform)/farmer/requests/inspection-actions";
import { VisitPanel } from "./VisitPanel";
import { placeLine } from "@/lib/chiefdoms";
import { EmptyState } from "@/components/app/EmptyState";
import { PendingButton } from "@/components/app/PendingButton";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION, extraDetails, landLabel } from "@/lib/land";
import Link from "next/link";
import { districtLabel } from "@/lib/business";
import { formatAmount } from "@/lib/money";
import { STATUS_LABEL, serviceLabel, type ServiceRequest } from "@/lib/requests";
import { describeOperations, operationsFor, planFor } from "@/lib/operations";
import { RESPONSE_HOURS, agreementFor, endDateOf, expiresAt, isExpired, listForRequest, paymentOverdue } from "@/lib/quotes";
import { serviceFeeOn } from "@/lib/fee";
import { db } from "@/lib/db";
import { acceptQuoteAction, declineQuoteAction } from "@/app/(platform)/farmer/requests/accept-actions";
import { cancelRequest } from "@/app/(platform)/farmer/book/actions";
import { confirmDeliveryAction, raiseConcernAction } from "@/app/(platform)/farmer/requests/job-actions";
import { JOB_STATUS_LABEL, jobForRequest, type JobStatus } from "@/lib/jobs";
import { bookingFor, methodLabel, paymentsFor } from "@/lib/payments";
import { releasesFor } from "@/lib/settlement";
import { Icon } from "@/components/app/Icon";
import { landSize } from "@/lib/land-size";
import { monimeTestMode } from "@/lib/monime";
import { payOnlineAction } from "@/app/(platform)/farmer/requests/pay-actions";
import { ZONE } from "@/lib/zone";

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: ZONE });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: ZONE,
  }).replace(" at ", ", ").toUpperCase().replace(/([A-Z]{3})/, (m) => m[0] + m.slice(1).toLowerCase());

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="request-row"><dt>{label}</dt><dd>{value}</dd></div>;
}

const businessName = async (id: string) =>
  ((await db.get("SELECT name FROM provider_business WHERE id=?", id)) as { name: string } | undefined)?.name ?? "A provider";

/**
 * The machines behind a quote, in words. Karim asked for the detail and no pictures: a farmer
 * comparing two prices wants to know whether the bigger one brings a bigger tractor.
 */
async function machinesOn(assetIds: readonly string[]): Promise<{ name: string; detail: string }[]> {
  return Promise.all(assetIds.map(async (id) => {
    const a = await db.get("SELECT name, kind, brand, model, year, horsepower, implements FROM equipment WHERE id=?", id) as
      { name: string; kind: string; brand: string; model: string; year: string; horsepower: string; implements: string } | undefined;
    if (!a) return { name: "Equipment", detail: "" };
    return {
      name: a.name,
      detail: [kindLabel(a.kind), [a.brand, a.model].filter(Boolean).join(" "), a.year, a.horsepower ? `${a.horsepower} hp` : "", a.implements]
        .filter(Boolean).join(" · "),
    };
  }));
}

/**
 * The stages behind a packaged quote, each with its own dates and price.
 *
 * A package is quoted as one figure over one run of days, which is right for comparing offers and
 * wrong for knowing what you have agreed to: "12 Dec to 18 Dec" does not say that the planting is
 * on the 18th. The provider planned each stage and Sagora is holding the machines for each stage,
 * so the farmer sees the same plan before accepting it. Nothing here for a single-stage quote.
 */
async function Stages({ quoteId }: { quoteId: string }) {
  const stages = await planFor(quoteId);
  if (stages.length < 2) return null;
  return (
    <>
      <p className="offer__label">The stages, in order</p>
      <ul className="offer__stages">
        {stages.map((s) => (
          <li key={s.id}>
            <strong>{s.sequence}. {s.serviceLabel}</strong>
            <span>
              {fmt(s.startDate)}{s.endDate !== s.startDate ? ` to ${fmt(s.endDate)}` : ""}
              {" · "}{formatAmount(s.amountMinor)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The equipment list on one quote. Its own component so the lookup can be awaited. */
async function Machines({ assetIds }: { assetIds: readonly string[] }) {
  if (assetIds.length === 0) return null;
  const machines = await machinesOn(assetIds);
  return (
    <>
      <p className="offer__label">Equipment for this work</p>
      <ul className="offer__machines">
        {machines.map((m) => (
          <li key={m.name + m.detail}>
            <strong>{m.name}</strong>
            {m.detail ? <span>{m.detail}</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** How long is left to answer a quote, said the way a person would say it. */
function timeLeft(until: Date): string {
  const ms = until.getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3600_000);
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"} left to answer`;
  return `${Math.max(1, Math.floor(ms / 60_000))} minutes left to answer`;
}

export type RequestLinks = {
  close: string;
  edit: string;
  again?: string;
  payments?: string;
  invoice?: string;
};

export type RequestFlags = { accepted?: string; error?: string; confirmed?: string; concern?: string; payment?: string };

/**
 * One request as its farmer sees it: details, payment, the work and the quotes. The same for a
 * farmer with an account and for someone who came back with a tracking code; only the links differ.
 */
/**
 * A payment deadline, to the hour.
 *
 * Shown with the time because it is an instant rather than a day: a quote accepted at four in the
 * afternoon is held until four two days later, and "15 Dec" would be a worse answer than useless.
 * Sierra Leone keeps UTC+0 all year, so Africa/Freetown and UTC render identically.
 */
const payDeadline = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ZONE,
  });

export async function RequestDetail({ request, links, flags, online, noQuotes = "No provider has quoted yet. We will email you when one does." }: {
  request: ServiceRequest;
  links: RequestLinks;
  flags: RequestFlags;
  /** Whether "Pay now" through Monime is offered to this person. */
  online: boolean;
  noQuotes?: string;
}) {
  const { accepted, error, confirmed, concern, payment } = flags;
  const id = request.id;
  const quotes = await listForRequest(id);
  // Every stage the farmer asked for, in the order the work happens. This screen is where a
  // package is accepted and paid for, so it is the one place that must not quietly reduce
  // "ploughing, then planting" to the stage it leads with.
  const stages = await operationsFor(id);
  const whatWasAsked = stages.length > 0 ? describeOperations(stages) : serviceLabel(request.service);
  const agreement = await agreementFor(id);
  const job = await jobForRequest(id);
  const inspections = await inspectionsForRequest(id);
  const booking = await bookingFor(id);
  const payments = await paymentsFor(id);
  const received = payments.reduce((n, p) => n + p.amountMinor, 0);
  const land = [
    request.landAccess && landLabel(LAND_ACCESS, request.landAccess),
    request.landCondition && landLabel(LAND_CONDITION, request.landCondition),
    request.landClearance && landLabel(LAND_CLEARANCE, request.landClearance),
  ].filter(Boolean) as string[];
  const refunds = (await releasesFor(id)).filter((r) => r.kind === "refund" && r.status !== "void");
  const due = agreement ? agreement.farmerTotalMinor - received : 0;
  // Read from the clock rather than from a swept column, so the screen is right the moment it
  // becomes right rather than after the nightly sweep has been round.
  const overdue = agreement ? paymentOverdue(agreement) : false;
  const scheduled = Boolean(job?.startDate && job.assetIds.length);

  // Everyone who has answered this request, one card each: a provider who wants to visit first and
  // later quotes is one person, not two entries in two different sections.
  const quoting = quotes.filter((q) => q.status !== "withdrawn");
  const responders = [...new Set([...inspections.map((i) => i.businessId), ...quoting.map((q) => q.businessId)])];
  const names = new Map(await Promise.all(responders.map(async (b) => [b, await businessName(b)] as const)));
  const visitsOpen = inspections.filter((i) => i.status === "required" || i.status === "scheduled");
  const liveQuotes = quoting.filter((q) => q.status === "sent" && !isExpired(q));
  const open = request.status === "awaiting_quotes" || request.status === "quotes_sent";

  // The one thing the farmer should do now, worked out from the records, in the order it matters.
  const visitAsk = inspections.find((i) => i.status === "required" && i.proposedSide !== "farmer");
  const next: { text: string; href: string; action: string } | null = agreement
    ? null
    : visitAsk
      ? visitAsk.proposedSide === "provider"
        ? { text: `${names.get(visitAsk.businessId)} suggested a day to visit your farm. Accept it, or choose another day.`, href: `#visit-${visitAsk.businessId}`, action: "Choose a date" }
        : { text: `${names.get(visitAsk.businessId)} wants to visit your farm before giving a price. Choose a day that suits you.`, href: `#visit-${visitAsk.businessId}`, action: "Choose a date" }
      : liveQuotes.length > 0
        ? { text: liveQuotes.length === 1 ? "You have a quote to review." : `You have ${liveQuotes.length} quotes to compare.`, href: "#responses", action: liveQuotes.length === 1 ? "Review quote" : "Review quotes" }
        : null;

  return (
    <>
    <section className="req-hub__head" aria-labelledby="req-title">
      <div className="req-hub__title">
        <div>
          <p className="req-hub__eyebrow">Request {request.reference}</p>
          <h1 id="req-title">{whatWasAsked}</h1>
          <p className="req-hub__meta">
            {placeLine(request.village, request.chiefdom, districtLabel(request.district))} · {landSize(request.acres)} · Sent {fmt(request.createdAt.slice(0, 10))}
          </p>
        </div>
        {booking && request.status === "in_progress"
          ? <span className="pill pill--quotes_sent">Booked</span>
          : <span className={`pill pill--${request.status}`}>{STATUS_LABEL[request.status]}</span>}
      </div>
      {/* Counted from the records every time the page is drawn: who answered, who wants a visit,
          who has priced it. */}
      {responders.length > 0 ? (
        <ul className="req-hub__counts" aria-label="Provider responses">
          <li><strong>{responders.length}</strong> {responders.length === 1 ? "provider interested" : "providers interested"}</li>
          {inspections.length > 0 ? <li><strong>{inspections.length}</strong> {inspections.length === 1 ? "wants to visit your farm" : "want to visit your farm"}</li> : null}
          <li><strong>{quoting.length}</strong> {quoting.length === 1 ? "quote received" : "quotes received"}</li>
        </ul>
      ) : open ? (
        <p className="req-hub__waiting">No provider has responded yet. Providers who do this work in your district can see your request, and we will tell you when one responds.</p>
      ) : null}
    </section>

    {next ? (
      <div className="req-hub__next" role="status">
        <p><strong>Next step:</strong> {next.text}</p>
        <a href={next.href} className="button button--inline">{next.action}</a>
      </div>
    ) : null}

    {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
    {payment === "received" ? (
      <p className="notice notice--success" role="status">Thank you. Your payment was received.</p>
    ) : payment === "pending" ? (
      <p className="notice notice--success" role="status">
        Your payment is being confirmed. It shows here as soon as Monime confirms it.
      </p>
    ) : payment === "cancelled" ? (
      <p className="notice notice--error" role="status">The payment was not completed. You can try again.</p>
    ) : null}
    {accepted ? (
      <p className="notice notice--success" role="status">
        You accepted this quote. The price and terms are now fixed. The work is booked once the
        payment is in and the equipment is still free for your dates.
      </p>
    ) : null}

    {agreement ? (
      <section className="quote-card">
        <div className="quote-card__head">
          <div>
            <h3>Payment</h3>
            <p>
              {booking
                ? `${formatAmount(received)} of ${formatAmount(agreement.farmerTotalMinor)} received and booked.`
                : received === 0
                  ? "Nothing received yet."
                  : `${formatAmount(received)} of ${formatAmount(agreement.farmerTotalMinor)} received.`}
            </p>
          </div>
          {/* What the farmer owes, which is the provider's price with Sagora's fee on top. */}
          <p className="quote-card__price">{formatAmount(agreement.farmerTotalMinor)}</p>
        </div>

        {agreement.feeMinor > 0 ? (
          <dl className="offer__breakdown">
            <div><dt>Service price</dt><dd>{formatAmount(agreement.amountMinor)}</dd></div>
            <div><dt>Sagora service fee</dt><dd>{formatAmount(agreement.feeMinor)}</dd></div>
            <div className="offer__breakdown-total"><dt>Total</dt><dd>{formatAmount(agreement.farmerTotalMinor)}</dd></div>
          </dl>
        ) : null}

        {/* A07: "hold the reservation for a bounded period between acceptance and payment, and show
            the deadline." Said here rather than only enforced, because a farmer who does not know
            there is a deadline cannot meet it — and because the machines really do go back on the
            market when it passes, which is not something to spring on anybody.

            Three states: still running, run out, already let go. Agreements accepted before this
            rule existed carry no deadline and say nothing. */}
        {!booking && agreement.lapsedAt ? (
          <p className="notice notice--error" role="status">
            The equipment was held for you until {payDeadline(agreement.payBy)} and has now been released,
            so these dates are no longer reserved. Your provider can send you a new quote, and anything you
            have paid is safe.
          </p>
        ) : !booking && agreement.payBy ? (
          overdue ? (
            <p className="notice notice--error" role="status">
              The deadline for paying was {payDeadline(agreement.payBy)}. The equipment is being released
              for other work. Pay now, or ask your provider for new dates.
            </p>
          ) : (
            <p className="notice notice--warn" role="status">
              Your equipment and operator are held until <strong>{payDeadline(agreement.payBy)}</strong>.
              {due > 0 ? ` ${formatAmount(due)} is still to come.` : ""} After that the dates go back
              on the market.
            </p>
          )
        ) : null}

        {/* The brief keeps these two apart on purpose: money in is not a booking. */}
        <p className="asset__state">
          <span className={`pill pill--${received >= agreement.farmerTotalMinor ? "completed" : received > 0 ? "in_progress" : "awaiting_quotes"}`}>
            {received >= agreement.farmerTotalMinor ? "Payment complete" : received > 0 ? "Part paid" : "Not paid"}
          </span>
          <span className={`pill pill--${booking ? "completed" : "awaiting_quotes"}`}>
            {booking ? "Booking confirmed" : "Booking not confirmed"}
          </span>
        </p>

        {payments.length > 0 ? (
          <ul className="asset__faults">
            {payments.map((p) => (
              <li key={p.id}>
                <span className="asset__fault-text">
                  {formatAmount(p.amountMinor)} by {methodLabel(p.method)} · {p.externalRef}
                </span>
                <span className="field__helper">
                  {fmt(p.recordedAt.slice(0, 10))}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {!booking && received > 0 && received < agreement.amountMinor ? (
          <p className="field__helper">
            {formatAmount(agreement.amountMinor - received)} is still to come. Your dates are not held
            until the full amount is in.
          </p>
        ) : null}
        {!booking && received >= agreement.amountMinor ? (
          <p className="notice notice--error" role="status">
            Your payment is in, but the booking is not confirmed — the equipment is no longer free for
            those dates. Sagora is sorting this out with you and your money is safe.
          </p>
        ) : null}

        {refunds.length > 0 ? (
          <p className="field__helper">
            {refunds.map((r) => `${formatAmount(r.netMinor)} refund ${r.status === "paid" ? "sent" : "being processed"}`).join(" · ")}
          </p>
        ) : null}

        {online && !booking && due > 0 ? (
          scheduled ? (
            <form action={payOnlineAction} className="pay-online">
              <input type="hidden" name="requestId" value={request.id} />
              <PendingButton className="button">Pay {formatAmount(due)} now</PendingButton>
              <p className="field__helper">
                Pay by mobile money, card or bank on Monime&apos;s secure page.
                {monimeTestMode() ? " Test mode: no real money moves." : ""}
              </p>
            </form>
          ) : (
            <p className="field__helper">You can pay once the provider has scheduled the work.</p>
          )
        ) : null}

        <p className="field__helper">
          {online
            ? "Online payments go through Monime, Sagora's payment provider. Other payments are recorded by the Sagora team from your receipt. "
            : "Payments are recorded by the Sagora team from your receipt, not by an automatic payment provider yet. "}
          {links.payments ? <><Link href={links.payments}>See all your payments</Link>.</> : null}
        </p>
        {booking && links.invoice ? <p className="field__helper"><a href={links.invoice}>Download invoice (PDF)</a></p> : null}
      </section>
    ) : null}

    {confirmed ? (
      <p className="notice notice--success" role="status">
        Thank you. You have confirmed the work. Payment and settlement are arranged separately.
      </p>
    ) : null}
    {concern ? (
      <p className="notice notice--error" role="status">
        Your concern has been recorded and the provider has been told. Sagora will follow up.
      </p>
    ) : null}

    {job && job.status !== "unscheduled" ? (
      <section className="quote-card">
        <div className="quote-card__head">
          <div>
            <h3>The work</h3>
            <p>{JOB_STATUS_LABEL[job.status as JobStatus]}</p>
          </div>
          {job.startDate ? <p className="field__helper">{fmt(job.startDate)} to {fmt(job.endDate!)}</p> : null}
        </div>

        {job.status === "work_reported" ? (
          <>
            <p>
              The provider reports <strong>{landSize(job.reportedAcres)}</strong> done.
              {job.workNote ? ` Their note: ${job.workNote}` : ""}
            </p>
            <p className="field__helper">Nothing is settled until you confirm. If something is wrong, say so instead.</p>
            <form action={confirmDeliveryAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <PendingButton className="button button--inline">Confirm the work was done</PendingButton>
            </form>
            <form action={raiseConcernAction} className="form-soft" style={{ maxWidth: "none" }}>
              <input type="hidden" name="requestId" value={request.id} />
              <div className="field">
                <label className="field__label" htmlFor="concern">Or raise a concern</label>
                <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
                  <textarea id="concern" name="concern" className="field__input" rows={2} maxLength={400}
                    placeholder="Only half the field was done" style={{ resize: "vertical" }} />
                </div>
              </div>
              <PendingButton className="button button--soft button--inline">Raise a concern</PendingButton>
            </form>
          </>
        ) : null}

        {job.status === "completed" ? <p className="field__helper">You confirmed {landSize(job.reportedAcres)}.</p> : null}
        {job.status === "disputed" ? <p className="field__helper">Your concern: {job.concern}</p> : null}
      </section>
    ) : null}

    {/* Everyone who answered, one card each, with what they asked for (a visit) and what they
        offered (a quote) together. This is the part of the page a farmer opens it to see. */}
    <section className="req-hub__section" id="responses" aria-labelledby="responses-title">
      <h2 className="quotes__heading" id="responses-title">People interested in your request</h2>
      {responders.length === 0 ? (
        <EmptyState icon="quotes" title="No responses yet" body={noQuotes} />
      ) : (
        <div className="quote-cards">
          {responders.map((businessId) => {
            const visit = inspections.find((i) => i.businessId === businessId);
            const q = quoting.find((x) => x.businessId === businessId);
            const name = names.get(businessId) ?? "A provider";
            const expired = q ? isExpired(q) : false;
            const isAgreed = agreement?.businessId === businessId;
            const response = q
              ? q.status === "accepted" ? "Quote accepted" : q.declinedAt ? "Quote declined" : q.status === "not_selected" ? "Not chosen" : expired ? "Quote expired" : "Quote received"
              : visit?.status === "completed" ? "Farm visited" : visit?.status === "scheduled" ? "Visit booked" : "Inspection requested";
            const pill = q
              ? q.status === "accepted" ? "completed" : q.status === "sent" && !expired && !q.declinedAt ? "in_progress" : "cancelled"
              : visit?.status === "scheduled" || visit?.status === "completed" ? "quotes_sent" : "awaiting_quotes";
            return (
              <article key={businessId} id={`visit-${businessId}`} className={`offer${isAgreed ? " offer--agreed" : ""}`}>
                {q ? (
                  <div className="offer__price">
                    <div>
                      <p className="offer__amount">{formatAmount(q.amountMinor)}</p>
                      <p>Total price for {whatWasAsked.toLowerCase()} {landSize(request.acres)}</p>
                    </div>
                  </div>
                ) : null}
                <div className="offer__body">
                  <div className="offer__who">
                    <h3>{name}</h3>
                    <span className={`pill pill--${pill}`}>{response}</span>
                  </div>
                  <p className="offer__meta">
                    <span>{q ? `Quote sent on ${fmt(q.createdAt.slice(0, 10))}` : `Responded on ${fmt((visit?.updatedAt ?? request.createdAt).slice(0, 10))}`}</span>
                  </p>

                  {/* The farm visit, when this provider asked for one. Agreed here, on the request,
                      by suggesting a day or accepting theirs. */}
                  {visit && visit.status !== "completed" && !agreement ? (
                    <>
                      {visit.status === "required" ? (
                        <p className="offer__text">
                          {name} would like to see your farm before giving you a price. The visit is free, and their price comes after it.
                        </p>
                      ) : null}
                      <VisitPanel me="farmer" visit={visit} requestId={request.id} businessId={businessId} idPrefix={`fv-${visit.id}`}
                        accept={acceptInspectionAction} suggest={proposeInspectionAction} otherName={name} />
                    </>
                  ) : visit?.status === "completed" ? (
                    <p className="field__helper">Visited your farm{visit.scheduledFor ? ` on ${fmt(visit.scheduledFor)}` : ""}{visit.findings ? `: ${visit.findings}` : "."}</p>
                  ) : null}

                  {q ? (
                    <>
                      {q.includes ? (
                        <>
                          <p className="offer__label">Includes</p>
                          <p className="offer__text">{q.includes}</p>
                        </>
                      ) : null}
                      {/* The three things Karim asked a farmer be able to compare, not just the price:
                          how long the work takes, which machines come, and how long the offer stands. */}
                      <p className="offer__label">How long it takes</p>
                      <p className="offer__text">
                        {q.daysToComplete} {q.daysToComplete === 1 ? "day" : "days"} &mdash; {fmt(q.startDate)} to {fmt(endDateOf(q))}
                      </p>
                      <Stages quoteId={q.id} />
                      <Machines assetIds={q.assetIds} />
                      {land.length > 0 ? (
                        <ul className="offer__chips">
                          {land.map((l) => <li key={l}><span className="chip__icon" aria-hidden="true" />{l}</li>)}
                        </ul>
                      ) : null}
                      {/* The breakdown, before they accept and before they pay. Sagora's fee is added
                          to the provider's price, so the total is never a surprise at the payment screen. */}
                      <p className="offer__label">What you pay</p>
                      <dl className="offer__breakdown">
                        <div><dt>{name}&rsquo;s price</dt><dd>{formatAmount(q.amountMinor)}</dd></div>
                        <div><dt>Sagora service fee</dt><dd>{formatAmount(serviceFeeOn(q.amountMinor))}</dd></div>
                        <div className="offer__breakdown-total">
                          <dt>Total</dt><dd>{formatAmount(q.amountMinor + serviceFeeOn(q.amountMinor))}</dd>
                        </div>
                      </dl>
                      {q.dailyRateMinor > 0 ? (
                        <p className="offer__text">
                          {q.daysToComplete} working {q.daysToComplete === 1 ? "day" : "days"} at {formatAmount(q.dailyRateMinor)} a day,
                          finishing by {fmt(endDateOf(q))}.
                        </p>
                      ) : null}
                      {q.note ? (
                        <>
                          <p className="offer__label">Message from provider</p>
                          <p className="offer__text">{q.note}</p>
                        </>
                      ) : null}
                      {q.status === "sent" ? (
                        <p className={expired ? "notice notice--error" : "offer__deadline"} role={expired ? "alert" : undefined}>
                          {expired
                            ? `This quote was not answered within ${RESPONSE_HOURS} hours, so it can no longer be accepted.`
                            : timeLeft(expiresAt(q))}
                        </p>
                      ) : null}
                      {q.status === "accepted" ? (
                        <p className="notice notice--success">You accepted this quote (version {q.version}).</p>
                      ) : q.declinedAt ? (
                        <p className="field__helper">You declined this quote.</p>
                      ) : q.status === "not_selected" ? (
                        <p className="field__helper">You chose another provider.</p>
                      ) : expired ? (
                        <p className="field__helper">This price has expired. Ask the provider for a new one.</p>
                      ) : agreement ? (
                        <p className="field__helper">You have already accepted a quote on this request.</p>
                      ) : (
                        <div className="request-card__actions">
                          <form action={declineQuoteAction}>
                            <input type="hidden" name="quoteId" value={q.id} />
                            <input type="hidden" name="requestId" value={request.id} />
                            <PendingButton confirm="Decline this quote?" confirmBody="The provider will be told." confirmAction="Decline quote" className="button button--soft">Decline</PendingButton>
                          </form>
                          <form action={acceptQuoteAction}>
                            <input type="hidden" name="quoteId" value={q.id} />
                            <input type="hidden" name="requestId" value={request.id} />
                            <PendingButton className="button" confirm="Accept this quote?" confirmBody="The price and terms become fixed, and the other quotes close. The work is booked once your payment is in and the equipment is still free." confirmAction="Accept quote">Accept quote</PendingButton>
                          </form>
                        </div>
                      )}
                    </>
                  ) : visit && visit.status !== "required" ? (
                    <p className="field__helper">Their price comes after the visit. We will tell you when it arrives.</p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>

    {/* What the farmer asked for, and the ways to change it: there when wanted, never in the way of
        the responses above. */}
    <details className="req-hub__details">
      <summary>Request details</summary>
      <dl className="request-rows">
        <Detail label="Request ID" value={request.reference} />
        <Detail label="Requested on" value={fmtTime(request.createdAt)} />
        <Detail label={stages.length > 1 ? "Services, in order" : "Service"} value={whatWasAsked} />
        <Detail label="Land size" value={landSize(request.acres)} />
        <Detail label="Location" value={placeLine(request.village, request.chiefdom, districtLabel(request.district))} />
        <Detail label="Preferred start date" value={fmt(request.preferredDate)} />
        {request.crop ? <Detail label="Crop" value={request.crop} /> : null}
        <Detail label="Land access" value={landLabel(LAND_ACCESS, request.landAccess)} />
        <Detail label="Land condition" value={landLabel(LAND_CONDITION, request.landCondition)} />
        <Detail label="Land clearance" value={landLabel(LAND_CLEARANCE, request.landClearance)} />
        {extraDetails(request).map((x) => <Detail key={x.label} label={x.label} value={x.value} />)}
      </dl>
    </details>

    <div className="req-hub__manage">
      <Link href={links.close} className="button button--soft button--inline">Back to my requests</Link>
      {request.status === "awaiting_quotes" ? <Link href={links.edit} className="button button--soft button--inline">Edit request</Link> : null}
      {request.status === "completed" && links.again ? <Link href={links.again} className="button button--inline">Book again</Link> : null}
      {open ? (
        <form action={cancelRequest}>
          <input type="hidden" name="id" value={request.id} />
          <PendingButton confirm="Withdraw this request?" confirmBody="Providers will no longer see it." confirmAction="Withdraw request" className="button button--soft button--inline">Withdraw request</PendingButton>
        </form>
      ) : null}
    </div>
    </>
  );
}
