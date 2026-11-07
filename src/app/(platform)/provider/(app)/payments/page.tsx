import { EmptyState } from "@/components/app/EmptyState";
import { ModalShell } from "@/components/app/ModalShell";
import { PendingButton } from "@/components/app/PendingButton";
import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { Icon } from "@/components/app/Icon";
import { formatAmount } from "@/lib/money";
import { serviceLabel } from "@/lib/requests";
import { JOB_STATUS_LABEL, type JobStatus } from "@/lib/jobs";
import {
  FEE_POLICY, RELEASE_STATUS_LABEL, destinationFor, earningsFor, feeFor, paidJobCount, getPayoutRequest, latestPayoutRequest, openPayoutRequest, walletBalance,
  type Destination,
} from "@/lib/settlement";
import { requestPayoutAction } from "./actions";
import { DestinationForm } from "@/components/payments/DestinationForm";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
/** "15 Sep 2026, 10:24 AM", as the design writes when a payout was asked for. */
const at = (iso: string) => {
  const d = new Date(iso);
  return `${when(iso)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Freetown" })}`;
};
/** The design names a mobile money payout account after Monime. */
const methodName = (d: Destination) => (d.method === "bank" ? d.bank || "Bank account" : "Monime");
const accountShown = (d: Destination) => (d.method === "bank" ? d.accountRef : d.accountRef.replace(/^\+232(\d{2})(\d{3})(\d{3})$/, "+232 $1 $2 $3"));

export default async function Page({ searchParams }: { searchParams: Promise<{ withdraw?: string; submitted?: string; error?: string; payout?: string }> }) {
  const { user, business, permission } = await requireWorkspace();
  // Earnings and payout details are the owner's business, not every operator's.
  if (permission !== "full_access") {
    return (
      <Shell crumb={{ label: "Payments", icon: "payments" }} user={{ name: user.name }}>
        <PageHead title="Payments" subtitle="View your earnings, payout details and transactions." />
        <div className="table-card"><EmptyState icon="payments" title="Payments are private" body="Only someone with full access can see payments." /></div>
      </Shell>
    );
  }
  const sp = await searchParams;
  const wallet = await walletBalance(business.id);
  const open = await openPayoutRequest(business.id);
  const submitted = sp.submitted ? await getPayoutRequest(business.id, sp.submitted) : null;
  const latest = sp.payout ? await latestPayoutRequest(business.id) : null;
  const rows = await earningsFor(business.id);
  const destination = await destinationFor(business.id);
  // UC10: what Sagora takes is shown, not left to be worked out from a smaller payout.
  const paidJobs = await paidJobCount(business.id);
  const freeLeft = Math.max(0, FEE_POLICY.freeJobs - paidJobs);

  return (
    <Shell crumb={{ label: "Payments", icon: "payments" }} user={{ name: user.name }}>
      <PageHead
        title="Payments"
        subtitle="View your earnings, payout details and transactions."
      />

      {sp.error ? <p className="notice notice--error" role="alert">{sp.error}</p> : null}
      <section className="wallet">
        <h2 className="wallet__label">Your wallet</h2>
        <div className="wallet__body">
          <div>
            <p className="wallet__sub">Total balance</p>
            <p className="wallet__amount">{formatAmount(wallet)}</p>
            {open ? <p className="field__helper">Payout request {open.reference} is in progress.</p> : null}
          </div>
          <div className="wallet__actions">
            <Link href="/provider/payments?payout=1" className="wallet__details"><Icon name="info" size={20} />Payout details</Link>
            {permission === "full_access" && wallet > 0 && destination && !open
              ? <Link href="/provider/payments?withdraw=1" className="button"><Icon name="arrowOut" size={20} />Withdraw funds</Link>
              : <button type="button" className="button" disabled><Icon name="arrowOut" size={20} />Withdraw funds</button>}
          </div>
        </div>
      </section>

      {sp.withdraw && destination && wallet > 0 && !open ? (
        <ModalShell closeHref="/provider/payments" label="Confirm payout request">
            <header className="modal__head">
              <h2 id="po-confirm">Confirm payout request</h2>
              <p>Review the details before submitting</p>
            </header>
            <dl className="request-rows">
              <div className="request-row"><dt>Method</dt><dd>{methodName(destination)}</dd></div>
              <div className="request-row"><dt>Account</dt><dd>{accountShown(destination)}</dd></div>
            </dl>
            <p className="field__label">Payout amount</p>
            <p className="wallet__amount">{formatAmount(wallet)}</p>
            <p className="field__helper">This is your current available balance.</p>
            <div className="request-card__actions">
              <Link href="/provider/payments" className="button button--soft">Cancel</Link>
              <form action={requestPayoutAction}><PendingButton className="button">Submit request</PendingButton></form>
            </div>
        </ModalShell>
      ) : null}

      {submitted ? (
        <ModalShell closeHref="/provider/payments" label="Payout request submitted">
            <header className="modal__head">
              <h2 id="po-done">Payout request submitted</h2>
              <p>Your payout request has been submitted and is being reviewed</p>
            </header>
            <dl className="request-rows">
              <div className="request-row"><dt>Payout amount</dt><dd>{formatAmount(submitted.amountMinor)}</dd></div>
              <div className="request-row"><dt>Transaction ID</dt><dd>{submitted.reference}</dd></div>
              {destination ? <div className="request-row"><dt>Method</dt><dd>{methodName(destination)}</dd></div> : null}
              <div className="request-row"><dt>Requested on</dt><dd>{at(submitted.requestedAt)}</dd></div>
            </dl>
            <div className="request-card__actions">
              <Link href="/provider/payments" className="button">Done</Link>
            </div>
        </ModalShell>
      ) : null}

      {rows.length === 0 ? (
        <div className="table-card">
          <EmptyState icon="payments" title="You have not received any payments yet" body="Set up a payout wallet to start receiving payments for your services" href="/provider/payments?payout=change" action="Set up your payout wallet" />
        </div>
      ) : (
        <>
        <p className="field__helper fee-note">
          {!FEE_POLICY.approved
            ? "Sagora takes no fee at the moment."
            : freeLeft > 0
              ? `Sagora's fee is ${FEE_POLICY.pilotPercent}% of each job's agreed price, after your first ${FEE_POLICY.freeJobs} paid jobs. You have ${freeLeft} fee-free ${freeLeft === 1 ? "job" : "jobs"} left.`
              : `Sagora's fee is ${FEE_POLICY.pilotPercent}% of each job's agreed price. It is taken from the payment before it is sent to you.`}
        </p>
        <div className="table-card">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Work</th>
                <th scope="col">Agreed</th>
                <th scope="col">Farmer has paid</th>
                <th scope="col">Progress</th>
                <th scope="col">Your payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.requestId}>
                  <td>{r.reference}</td>
                  <td>{serviceLabel(r.service)}</td>
                  <td>{formatAmount(r.amountMinor)}</td>
                  <td><span>
                    {formatAmount(r.receivedMinor)}
                    {r.receivedMinor > 0 && r.receivedMinor < r.amountMinor ? (
                      <>
                        <br />
                        <span className="field__helper">{formatAmount(r.amountMinor - r.receivedMinor)} still to come</span>
                      </>
                    ) : null}
                  </span></td>
                  <td>
                    <span className={`pill pill--${r.jobStatus === "completed" ? "completed" : r.jobStatus === "disputed" ? "cancelled" : "awaiting_quotes"}`}>
                      {JOB_STATUS_LABEL[r.jobStatus as JobStatus] ?? r.jobStatus}
                    </span>
                  </td>
                  <td><span>
                    {r.release ? (
                      <>
                        {formatAmount(r.release.netMinor)}
                        <br />
                        <span className="field__helper">
                          {r.release.feeMinor > 0 ? `${formatAmount(r.release.grossMinor)} less Sagora fee ${formatAmount(r.release.feeMinor)}` : "No Sagora fee on this job"}
                        </span>
                        <br />
                        <span className="field__helper">
                          {RELEASE_STATUS_LABEL[r.release.status]}
                          {r.release.status === "paid" && r.release.paidAt ? ` ${when(r.release.paidAt)} · ${r.release.externalRef}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="field__helper">
                        {r.jobStatus === "completed" ? "Being prepared" : "After the farmer confirms the work"}
                        <br />
                        {feeFor(r.amountMinor, paidJobs) > 0
                          ? `About ${formatAmount(r.amountMinor - feeFor(r.amountMinor, paidJobs))} after Sagora's fee of ${formatAmount(feeFor(r.amountMinor, paidJobs))}`
                          : `${formatAmount(r.amountMinor)}, no Sagora fee`}
                      </span>
                    )}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {sp.payout && (sp.payout === "change" || !destination) ? (
        <ModalShell closeHref="/provider/payments" label="Add payment method" className="modal--asset">
          <DestinationForm
            cancelHref="/provider/payments"
            changing={Boolean(destination)}
            initial={{
              method: destination?.method ?? "",
              accountName: destination?.accountName ?? business.name,
              accountRef: destination?.accountRef ?? "",
              bank: destination?.bank ?? "",
            }}
          />
        </ModalShell>
      ) : sp.payout && destination ? (
        <ModalShell closeHref="/provider/payments" label="Payout details" className="modal--asset">
          <header className="modal__head modal__head--center">
            <h2>Payout details</h2>
            {latest ? <p>View the details of this payout request</p> : null}
          </header>
          <dl className="request-rows">
            {latest ? (
              <>
                <div className="request-row"><dt>Payout amount</dt><dd>{formatAmount(latest.amountMinor)}</dd></div>
                <div className="request-row"><dt>Transaction ID</dt><dd>{latest.reference}</dd></div>
                <div className="request-row"><dt>Requested on</dt><dd>{at(latest.requestedAt)}</dd></div>
                <div className="request-row">
                  <dt>Status</dt>
                  <dd><span className={`pill pill--${latest.status === "requested" ? "in_progress" : "completed"}`}>{latest.status === "requested" ? "In progress" : "Completed"}</span></dd>
                </div>
              </>
            ) : null}
            <div className="request-row"><dt>Method</dt><dd>{methodName(destination)}</dd></div>
            <div className="request-row"><dt>Account</dt><dd>{accountShown(destination)}</dd></div>
            <div className="request-row"><dt>Account name</dt><dd>{destination.accountName}</dd></div>
          </dl>
          <p className="field__helper">Payouts are sent by the Sagora team and recorded with a transfer reference.</p>
          <div className="request-card__actions">
            <Link href="/provider/payments?payout=change" className="button button--soft">Change payout account</Link>
            <Link href="/provider/payments" className="button">Done</Link>
          </div>
        </ModalShell>
      ) : null}
    </Shell>
  );
}
