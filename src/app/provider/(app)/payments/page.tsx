import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { Icon } from "@/components/app/Icon";
import { formatAmount } from "@/lib/money";
import { serviceLabel } from "@/lib/requests";
import { JOB_STATUS_LABEL, type JobStatus } from "@/lib/jobs";
import {
  RELEASE_STATUS_LABEL, destinationFor, earningsFor, getPayoutRequest, openPayoutRequest, walletBalance,
} from "@/lib/settlement";
import { requestPayoutAction } from "./actions";
import { DestinationForm } from "@/components/payments/DestinationForm";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function Page({ searchParams }: { searchParams: Promise<{ withdraw?: string; submitted?: string; error?: string }> }) {
  const { user, business, permission } = await requireWorkspace();
  const sp = await searchParams;
  const wallet = await walletBalance(business.id);
  const open = await openPayoutRequest(business.id);
  const submitted = sp.submitted ? await getPayoutRequest(business.id, sp.submitted) : null;
  const rows = await earningsFor(business.id);
  const destination = await destinationFor(business.id);

  const agreed = rows.reduce((n, r) => n + r.amountMinor, 0);
  const paidOut = rows.reduce((n, r) => n + (r.release?.status === "paid" ? r.release.netMinor : 0), 0);
  const dueToYou = rows.reduce(
    (n, r) => n + (r.release && r.release.status !== "paid" ? r.release.netMinor : 0),
    0,
  );

  return (
    <Shell crumb={{ label: "Payments", icon: "payments" }} user={{ name: user.name }}>
      <PageHead
        title="Payments"
        subtitle="View your earnings, payout details and transaction history"
      />

      {sp.error ? <p className="notice notice--error" role="alert">{sp.error}</p> : null}
      <section className="wallet">
        <div>
          <p className="wallet__label">Your wallet</p>
          <p className="wallet__sub">Total balance</p>
          <p className="wallet__amount">{formatAmount(wallet)}</p>
          {open ? <p className="field__helper">Payout request {open.reference} is in progress.</p> : null}
        </div>
        <div className="wallet__actions">
          <a href="#payout-details" className="button button--soft">Payout details</a>
          {permission === "full_access" && wallet > 0 && destination && !open
            ? <Link href="/provider/payments?withdraw=1" className="button">Withdraw funds</Link>
            : <button type="button" className="button" disabled>Withdraw funds</button>}
        </div>
      </section>

      {sp.withdraw && destination && wallet > 0 && !open ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="po-confirm">
            <header className="modal__head">
              <h2 id="po-confirm">Confirm payout request</h2>
              <p>Review the details before submitting</p>
            </header>
            <dl className="request-rows">
              <div className="request-row"><dt>Method</dt><dd>{destination.method === "bank" ? destination.bank : "Mobile money"}</dd></div>
              <div className="request-row"><dt>Account</dt><dd>{destination.accountRef}</dd></div>
              <div className="request-row"><dt>Payout amount</dt><dd>{formatAmount(wallet)}</dd></div>
            </dl>
            <p className="field__helper">This is your current available balance.</p>
            <div className="request-card__actions">
              <Link href="/provider/payments" className="button button--soft">Cancel</Link>
              <form action={requestPayoutAction}><button type="submit" className="button">Submit request</button></form>
            </div>
          </div>
        </div>
      ) : null}

      {submitted ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="po-done">
            <header className="modal__head">
              <h2 id="po-done">Payout request submitted</h2>
            </header>
            <dl className="request-rows">
              <div className="request-row"><dt>Payout amount</dt><dd>{formatAmount(submitted.amountMinor)}</dd></div>
              <div className="request-row"><dt>Request ID</dt><dd>{submitted.reference}</dd></div>
              <div className="request-row"><dt>Requested on</dt><dd>{when(submitted.requestedAt)}</dd></div>
            </dl>
            <div className="request-card__actions">
              <Link href="/provider/payments" className="button">Done</Link>
            </div>
          </div>
        </div>
      ) : null}

      <div className="money-tiles">
        <article className="money-tile">
          <span className="money-tile__icon" aria-hidden="true"><Icon name="quotes" size={20} /></span>
          <p className="money-tile__value">{formatAmount(agreed)}</p>
          <p className="money-tile__label">Agreed across all jobs</p>
        </article>
        <article className="money-tile">
          <span className="money-tile__icon" aria-hidden="true"><Icon name="payments" size={20} /></span>
          <p className="money-tile__value">{formatAmount(dueToYou)}</p>
          <p className="money-tile__label">Approved or waiting to be sent</p>
        </article>
        <article className="money-tile">
          <span className="money-tile__icon" aria-hidden="true"><Icon name="store" size={20} /></span>
          <p className="money-tile__value">{formatAmount(paidOut)}</p>
          <p className="money-tile__label">Already paid to you</p>
        </article>
      </div>

      {rows.length === 0 ? (
        <div className="table-card">
          <p className="empty">No money yet. A job appears here once a farmer accepts your quote.</p>
        </div>
      ) : (
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
                  <td>
                    {formatAmount(r.receivedMinor)}
                    {r.receivedMinor > 0 && r.receivedMinor < r.amountMinor ? (
                      <>
                        <br />
                        <span className="field__helper">{formatAmount(r.amountMinor - r.receivedMinor)} still to come</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={`pill pill--${r.jobStatus === "completed" ? "completed" : r.jobStatus === "disputed" ? "cancelled" : "awaiting_quotes"}`}>
                      {JOB_STATUS_LABEL[r.jobStatus as JobStatus] ?? r.jobStatus}
                    </span>
                  </td>
                  <td>
                    {r.release ? (
                      <>
                        {formatAmount(r.release.netMinor)}
                        <br />
                        <span className="field__helper">
                          {RELEASE_STATUS_LABEL[r.release.status]}
                          {r.release.status === "paid" && r.release.paidAt ? ` ${when(r.release.paidAt)} · ${r.release.externalRef}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="field__helper">
                        {r.jobStatus === "completed" ? "Being prepared" : "After the farmer confirms the work"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="panel" id="payout-details">
        <h2 className="quotes__heading">Payout details</h2>
        <p className="field__helper">
          {destination
            ? `Currently ${destination.method === "bank" ? `${destination.bank} account` : "mobile money"} ${destination.accountRef}, in the name of ${destination.accountName}.`
            : "Not set yet. Add it so a payout can be sent without chasing you for details."}
        </p>
        <p className="field__helper">
          Payments are sent by hand by the Sagora team today and recorded with a transfer reference.
          Automatic payouts need the payment provider account, which we are still waiting on.
        </p>
        {permission === "full_access" ? (
          <DestinationForm
            initial={{
              method: destination?.method ?? "mobile_money",
              accountName: destination?.accountName ?? business.name,
              accountRef: destination?.accountRef ?? "",
              bank: destination?.bank ?? "",
            }}
          />
        ) : (
          <p className="field__helper">Only someone with full access can change this.</p>
        )}
      </section>
    </Shell>
  );
}
