import { PendingButton } from "@/components/app/PendingButton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { districtLabel } from "@/lib/business";
import { db } from "@/lib/db";
import { JOB_STATUS_LABEL, jobForRequest, type JobStatus } from "@/lib/jobs";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION, landLabel } from "@/lib/land";
import { formatAmount } from "@/lib/money";
import { agreementFor, isExpired, listForRequest } from "@/lib/quotes";
import { STATUS_LABEL, contactsFor, getById, serviceLabel } from "@/lib/requests";
import { requireStaff } from "@/lib/session";
import { StaffNav } from "@/components/staff/StaffNav";
import { acceptOnBehalfAction, confirmOnBehalfAction, logContactAction } from "../../assisted-actions";

export const metadata: Metadata = { title: "Assisted request" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const { error } = await searchParams;
  const r = await getById(id);
  if (!r || !r.assistedBy) notFound();

  const quotes = await listForRequest(id);
  const agreement = await agreementFor(id);
  const job = await jobForRequest(id);
  const log = await contactsFor(id);
  const names = new Map(await Promise.all(quotes.map(async (q) => [
    q.businessId, ((await db.get("SELECT name FROM provider_business WHERE id=?", q.businessId)) as { name: string } | undefined)?.name ?? "A provider",
  ] as const)));

  return (
    <main className="setup">
      <div className="setup__card setup__card--wide">
        <StaffNav current="requests" role={staff.role} />
        <h1 className="auth__title">{r.reference}</h1>
        {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        <dl className="setup__summary">
          <dt>Status</dt><dd>{STATUS_LABEL[r.status]}</dd>
          <dt>Farmer</dt><dd>{r.contactName}</dd>
          <dt>Called by</dt><dd>{r.callerName} ({r.callerRelation}) · {r.contactPhone}</dd>
          <dt>May accept</dt><dd>{r.mayAccept}</dd>
          <dt>Work</dt><dd>{serviceLabel(r.service)}{r.crop ? `, ${r.crop}` : ""}, {r.acres} acres</dd>
          <dt>Where</dt><dd>{r.village}, {districtLabel(r.district)}</dd>
          <dt>Land</dt><dd>{landLabel(LAND_ACCESS, r.landAccess)} · {landLabel(LAND_CONDITION, r.landCondition)} · {landLabel(LAND_CLEARANCE, r.landClearance)}</dd>
        </dl>

        <section className="staff__item">
          <h2>Quotes to read to the farmer</h2>
          {quotes.length === 0 ? <p className="field__helper">No provider has quoted yet.</p> : (
            <ul className="asset__faults">
              {quotes.map((q) => (
                <li key={q.id}>
                  <span className="asset__fault-text">{names.get(q.businessId)} · {formatAmount(q.amountMinor)} · {q.includes}</span>
                  {q.status === "sent" && !agreement && !isExpired(q) ? (
                    <form action={acceptOnBehalfAction}>
                      <input type="hidden" name="quoteId" value={q.id} />
                      <input type="hidden" name="requestId" value={r.id} />
                      <PendingButton className="resend__button">Accept for {r.mayAccept}</PendingButton>
                    </form>
                  ) : <span className="field__helper">{q.status === "accepted" ? "Accepted" : ""}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {job ? (
          <section className="staff__item">
            <h2>The work</h2>
            <p className="field__helper">{JOB_STATUS_LABEL[job.status as JobStatus]}</p>
            {job.status === "work_reported" ? (
              <form action={confirmOnBehalfAction}>
                <input type="hidden" name="requestId" value={r.id} />
                <PendingButton className="button button--inline">Farmer confirmed the work</PendingButton>
              </form>
            ) : null}
          </section>
        ) : null}

        <section className="staff__item">
          <h2>Calls</h2>
          <form action={logContactAction} className="form-soft">
            <input type="hidden" name="requestId" value={r.id} />
            <div className="field">
              <label className="field__label" htmlFor="outcome">What happened on the call</label>
              <div className="field__box"><input id="outcome" name="outcome" className="field__input" maxLength={400} /></div>
            </div>
            <PendingButton className="button button--inline">Save</PendingButton>
          </form>
          {log.length > 0 ? (
            <ul className="asset__faults">
              {log.map((c) => <li key={c.id}><span className="asset__fault-text">{c.outcome}</span><span className="field__helper">{when(c.createdAt)}</span></li>)}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  );
}
