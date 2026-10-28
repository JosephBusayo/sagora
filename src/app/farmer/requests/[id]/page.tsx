import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { formatAmount } from "@/lib/money";
import { STATUS_LABEL, getById, serviceLabel } from "@/lib/requests";
import { agreementFor, isExpired, listForRequest } from "@/lib/quotes";
import { db } from "@/lib/db";
import { acceptQuoteAction } from "../accept-actions";

export const metadata: Metadata = { title: "Request" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

const businessName = (id: string) =>
  (db.prepare("SELECT name FROM provider_business WHERE id=?").get(id) as { name: string } | undefined)?.name ?? "A provider";

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ accepted?: string; error?: string }>;
}) {
  const farmer = await requireFarmer();
  const { id } = await params;
  const { accepted, error } = await searchParams;

  const request = getById(id);
  if (!request || request.farmerId !== farmer.id) notFound(); // never reveal another farmer's request

  const quotes = listForRequest(id);
  const agreement = agreementFor(id);

  return (
    <main className="setup">
      <div className="setup__card setup__card--wide">
        <h1 className="auth__title">{request.reference}</h1>
        <p className="auth__subtitle">
          {serviceLabel(request.service)} · {request.acres} acres · {request.village}, {districtLabel(request.district)} ·
          {" "}preferred {fmt(request.preferredDate)}
        </p>
        <p><span className={`pill pill--${request.status}`}>{STATUS_LABEL[request.status]}</span></p>

        {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        {accepted ? (
          <p className="notice notice--success" role="status">
            You accepted this quote. The price and terms are now fixed. Paying for the work, and
            confirming the booking, come next — that part is not built yet.
          </p>
        ) : null}

        <h2 className="quotes__heading">Quotes</h2>
        {quotes.length === 0 ? (
          <p className="empty">No provider has quoted yet. We will email you when one does.</p>
        ) : (
          <div className="quote-cards">
            {quotes.map((q) => {
              const expired = isExpired(q);
              const isAgreed = agreement?.businessId === q.businessId;
              return (
                <article key={q.id} className={`quote-card${isAgreed ? " quote-card--agreed" : ""}`}>
                  <div className="quote-card__head">
                    <div>
                      <h3>{businessName(q.businessId)}</h3>
                      <p>Covers {q.includes}</p>
                    </div>
                    <p className="quote-card__price">{formatAmount(q.amountMinor)}</p>
                  </div>
                  <dl className="setup__summary">
                    <dt>Can start</dt><dd>{fmt(q.startDate)}</dd>
                    <dt>Price holds until</dt><dd>{fmt(q.validUntil)}{expired ? " (expired)" : ""}</dd>
                    {q.note ? (<><dt>Note</dt><dd>{q.note}</dd></>) : null}
                  </dl>
                  {q.status === "accepted" ? (
                    <p className="notice notice--success">You accepted this quote (version {q.version}).</p>
                  ) : q.status === "not_selected" ? (
                    <p className="field__helper">You chose another provider.</p>
                  ) : expired ? (
                    <p className="field__helper">This price has expired. Ask the provider for a new one.</p>
                  ) : agreement ? (
                    <p className="field__helper">You have already accepted a quote on this request.</p>
                  ) : (
                    <form action={acceptQuoteAction}>
                      <input type="hidden" name="quoteId" value={q.id} />
                      <input type="hidden" name="requestId" value={request.id} />
                      <button type="submit" className="button button--inline">Accept this quote</button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <p className="auth__footer"><Link href="/farmer/requests">Back to my requests</Link></p>
      </div>
    </main>
  );
}
