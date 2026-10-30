import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION, landLabel } from "@/lib/land";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { formatAmount } from "@/lib/money";
import { STATUS_LABEL, getById, serviceLabel } from "@/lib/requests";
import { agreementFor, isExpired, listForRequest } from "@/lib/quotes";
import { db } from "@/lib/db";
import { acceptQuoteAction, declineQuoteAction } from "../accept-actions";
import { cancelRequest } from "../../book/actions";
import { confirmDeliveryAction, raiseConcernAction } from "../job-actions";
import { JOB_STATUS_LABEL, jobForRequest, type JobStatus } from "@/lib/jobs";
import { bookingFor, methodLabel, paymentsFor } from "@/lib/payments";
import { releasesFor } from "@/lib/settlement";
import { Shell } from "@/components/app/Shell";
import { Icon } from "@/components/app/Icon";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Request" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC",
  }).replace(" at ", ", ").toUpperCase().replace(/([A-Z]{3})/, (m) => m[0] + m.slice(1).toLowerCase());

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="request-row"><dt>{label}</dt><dd>{value}</dd></div>;
}

const businessName = async (id: string) =>
  ((await db.get("SELECT name FROM provider_business WHERE id=?", id)) as { name: string } | undefined)?.name ?? "A provider";

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ accepted?: string; error?: string; confirmed?: string; concern?: string }>;
}) {
  const farmer = await requireFarmer();
  const { id } = await params;
  const { accepted, error, confirmed, concern } = await searchParams;

  const request = await getById(id);
  if (!request || request.farmerId !== farmer.id) notFound(); // never reveal another farmer's request

  const quotes = await listForRequest(id);
  const agreement = await agreementFor(id);
  const job = await jobForRequest(id);
  const booking = await bookingFor(id);
  const payments = await paymentsFor(id);
  const received = payments.reduce((n, p) => n + p.amountMinor, 0);
  const refunds = (await releasesFor(id)).filter((r) => r.kind === "refund" && r.status !== "void");

  return (
    <Shell
      crumb={{ label: "My requests", icon: "requests" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <>
        <section className="request-card">
          <div className="request-card__banner" aria-hidden="true">
            <span className="banner__ring banner__outer" />
            <span className="banner__ring banner__mid" />
            <span className="banner__ring banner__inner"><Icon name="payments" size={48} /></span>
          </div>
          <div className="request-card__body">
            <div className="request-card__title">
              <h1>Request details</h1>
              {request.status === "awaiting_quotes" || request.status === "quotes_sent" ? (
                <form action={cancelRequest}>
                  <input type="hidden" name="id" value={request.id} />
                  <button type="submit" className="request-card__delete" aria-label="Withdraw request"><Icon name="trash" size={24} /></button>
                </form>
              ) : null}
            </div>
            <dl className="request-rows">
              <Detail label="Request ID" value={request.reference} />
              <Detail label="Requested on" value={fmtTime(request.createdAt)} />
              <Detail label="Land size" value={`${request.acres} acres`} />
              <Detail label="Location" value={`${request.village}, ${districtLabel(request.district)}`} />
              <Detail label="Preferred start date" value={fmt(request.preferredDate)} />
              <Detail label="Land access" value={landLabel(LAND_ACCESS, request.landAccess)} />
              <Detail label="Land condition" value={landLabel(LAND_CONDITION, request.landCondition)} />
              <Detail label="Land clearance" value={landLabel(LAND_CLEARANCE, request.landClearance)} />
              <div className="request-row">
                <dt>Status</dt>
                <dd>
                  {booking && request.status === "in_progress"
                    ? <span className="pill pill--quotes_sent">Booked</span>
                    : <span className={`pill pill--${request.status}`}>{STATUS_LABEL[request.status]}</span>}
                </dd>
              </div>
            </dl>
            <div className="request-card__actions">
              {booking && request.status === "in_progress" ? (
                <Link href="/farmer/requests" className="button">Done</Link>
              ) : (
                <>
                  <Link href="/farmer/requests" className="button button--soft">Close</Link>
                  {request.status === "awaiting_quotes" ? <Link href={`/farmer/requests/${request.id}/edit`} className="button">Edit request</Link> : null}
                  {request.status === "quotes_sent" ? <a href="#quotes" className="button">View quotes</a> : null}
                  {request.status === "completed" ? <Link href={`/farmer/book?again=${request.id}`} className="button">Book again</Link> : null}
                </>
              )}
            </div>
          </div>
        </section>

        {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        {accepted ? (
          <p className="notice notice--success" role="status">
            You accepted this quote. The price and terms are now fixed. The work is booked once the
            payment is in and the machines are still free for your dates.
          </p>
        ) : null}

        {agreement ? (
          <section className="quote-card">
            <div className="quote-card__head">
              <div>
                <h3>Payment</h3>
                <p>
                  {booking
                    ? "Paid in full and booked."
                    : received === 0
                      ? "Nothing received yet."
                      : `${formatAmount(received)} of ${formatAmount(agreement.amountMinor)} received.`}
                </p>
              </div>
              <p className="quote-card__price">{formatAmount(agreement.amountMinor)}</p>
            </div>

            {/* The brief keeps these two apart on purpose: money in is not a booking. */}
            <p className="asset__state">
              <span className={`pill pill--${received >= agreement.amountMinor ? "completed" : received > 0 ? "in_progress" : "awaiting_quotes"}`}>
                {received >= agreement.amountMinor ? "Payment complete" : received > 0 ? "Part paid" : "Not paid"}
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
                      {new Date(p.recordedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
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
                Your payment is in, but the booking is not confirmed — the machines are no longer free for
                those dates. Sagora is sorting this out with you and your money is safe.
              </p>
            ) : null}

            {refunds.length > 0 ? (
              <p className="field__helper">
                {refunds.map((r) => `${formatAmount(r.netMinor)} refund ${r.status === "paid" ? "sent" : "being processed"}`).join(" · ")}
              </p>
            ) : null}

            <p className="field__helper">
              Payments are recorded by the Sagora team from your receipt, not by an automatic payment
              provider yet. <Link href="/farmer/payments">See all your payments</Link>.
            </p>
            {booking ? <p className="field__helper"><a href={`/farmer/requests/${request.id}/invoice`}>Download invoice (PDF)</a></p> : null}
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
                  The provider reports <strong>{job.reportedAcres} acres</strong> done.
                  {job.workNote ? ` Their note: ${job.workNote}` : ""}
                </p>
                <p className="field__helper">Nothing is settled until you confirm. If something is wrong, say so instead.</p>
                <form action={confirmDeliveryAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <button type="submit" className="button button--inline">Confirm the work was done</button>
                </form>
                <form action={raiseConcernAction} className="form-soft" style={{ maxWidth: "none" }}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <div className="field">
                    <label className="field__label" htmlFor="concern">Or raise a concern</label>
                    <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
                      <textarea id="concern" name="concern" className="field__input" rows={2} maxLength={400}
                        placeholder="Only half the field was ploughed" style={{ resize: "vertical" }} />
                    </div>
                  </div>
                  <button type="submit" className="button button--soft button--inline">Raise a concern</button>
                </form>
              </>
            ) : null}

            {job.status === "completed" ? <p className="field__helper">You confirmed {job.reportedAcres} acres.</p> : null}
            {job.status === "disputed" ? <p className="field__helper">Your concern: {job.concern}</p> : null}
          </section>
        ) : null}

        <h2 className="quotes__heading" id="quotes">Quotes</h2>
        {quotes.length === 0 ? (
          <p className="empty">No provider has quoted yet. We will email you when one does.</p>
        ) : (
          <div className="quote-cards">
            {quotes.map((q) => {
              const expired = isExpired(q);
              const isAgreed = agreement?.businessId === q.businessId;
              return (
                <article key={q.id} className={`offer${isAgreed ? " offer--agreed" : ""}`}>
                  <div className="offer__price">
                    <div>
                      <p className="offer__amount">{formatAmount(q.amountMinor)}</p>
                      <p>Total price for {serviceLabel(request.service).toLowerCase()} {request.acres} acres</p>
                    </div>
                    {q.status === "sent" && !expired ? <span className="pill pill--in_progress">Pending approval</span> : null}
                  </div>
                  <div className="offer__body">
                    <h3>{businessName(q.businessId)}</h3>
                    <p className="offer__meta">
                      <span>{serviceLabel(request.service)} request</span>
                      <span>Submitted on {fmt(q.createdAt.slice(0, 10))}</span>
                    </p>
                    {q.includes ? (
                      <>
                        <p className="offer__label">Includes</p>
                        <p className="offer__text">{q.includes}</p>
                      </>
                    ) : null}
                    <p className="offer__label">Message from provider</p>
                    <p className="offer__text">
                      I can start on {fmt(q.startDate)}. Price holds until {fmt(q.validUntil)}{expired ? " (expired)" : ""}.
                      {q.note ? ` ${q.note}` : ""}
                    </p>
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
                          <button type="submit" className="button button--soft">Decline</button>
                        </form>
                        <form action={acceptQuoteAction}>
                          <input type="hidden" name="quoteId" value={q.id} />
                          <input type="hidden" name="requestId" value={request.id} />
                          <button type="submit" className="button">Accept quote</button>
                        </form>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </>
    </Shell>
  );
}
