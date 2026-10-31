import { StaffNav } from "@/components/staff/StaffNav";
import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/session";
import { formatAmount } from "@/lib/money";
import { METHODS, awaitingPayment, methodLabel, openCases, paymentsFor } from "@/lib/payments";
import {
  FEE_POLICY, RELEASE_STATUS_LABEL, openPayoutRequests, pendingReleases, reconcile, releasesFor,
} from "@/lib/settlement";
import { jobForRequest, JOB_STATUS_LABEL, type JobStatus } from "@/lib/jobs";
import { signOut } from "@/app/provider/actions";
import {
  approveReleaseAction, closePayoutRequestAction, markSentAction, prepareRefundAction, preparePayoutAction,
  recordPaymentAction, resolveCaseAction, reviseReleaseAction, voidReleaseAction,
} from "../payments-actions";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const TABS = [
  { id: "collect", label: "To collect" },
  { id: "cases", label: "Cases" },
  { id: "releases", label: "Money out" },
  { id: "books", label: "Reconciliation" },
] as const;

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function MethodSelect({ name = "method" }: { name?: string }) {
  return (
    <select name={name} className="field__input" aria-label="How the money moved" defaultValue="mobile_money">
      {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  );
}

/**
 * The finance desk. Phase A of the brief: money is recorded by hand with its receipt reference
 * and labelled as such, while the ledger, the single booking decision and the two-person rule on
 * every release are real. There is no design for this screen yet — the Figma payments frames
 * (provider 15-10667, farmer 32-21589) have not been exported to us.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ok?: string; err?: string }>;
}) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : "collect";

  const collect = await awaitingPayment();
  const cases = await openCases();
  const releases = await pendingReleases();
  const withdrawals = await openPayoutRequests();
  const books = await reconcile();

  // A component cannot await inside its own JSX, so every per-row query is answered first.
  const paymentsByRequest = new Map(
    await Promise.all(collect.map(async (c) => [c.requestId, await paymentsFor(c.requestId)] as const)),
  );
  const heldJobs = new Map(
    await Promise.all(
      books.heldAfterCompletion.map(async (h) => [h.requestId, await jobForRequest(h.requestId)] as const),
    ),
  );

  // Jobs the farmer has confirmed and that still hold money: these are the ones to pay out.
  // Each row asks the database two questions, so they are all asked before any rendering.
  const payable = (
    await Promise.all(
      collect.map(async (c) => {
        if (!c.booked) return null;
        const job = await jobForRequest(c.requestId);
        if (job?.status !== "completed") return null;
        const released = (await releasesFor(c.requestId)).some((r) => r.kind === "payout" && r.status !== "void");
        return released ? null : c;
      }),
    )
  ).filter((c) => c !== null);

  return (
    <main className="setup">
      <div className="setup__card setup__card--wide setup__card--finance">
        <StaffNav current="payments" role={staff.role} />
        <h1 className="auth__title">Payments</h1>
        <p className="auth__subtitle">
          Every amount here was recorded by hand from a receipt — <strong>manual, not verified by a
          payment provider</strong>. {FEE_POLICY.approved
            ? `The platform fee is ${FEE_POLICY.pilotPercent}% after a provider's first ${FEE_POLICY.freeJobs} jobs.`
            : "No platform fee is being charged: the pilot fee sheet is not approved yet."}
        </p>

        {sp.ok ? <p className="notice notice--success" role="status">{sp.ok}</p> : null}
        {sp.err ? <p className="notice notice--error" role="status">{sp.err}</p> : null}

        <nav className="tabs tabs--page" aria-label="Payments sections">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/staff/payments?tab=${t.id}`}
              className={`tab${t.id === tab ? " tab--on" : ""}`}
              aria-current={t.id === tab ? "page" : undefined}
            >
              {t.label}
              {t.id === "cases" && cases.length > 0 ? ` (${cases.length})` : ""}
              {t.id === "releases" && releases.length > 0 ? ` (${releases.length})` : ""}
            </Link>
          ))}
        </nav>

        {tab === "collect" ? (
          collect.length === 0 ? (
            <p className="empty">No agreed job is waiting for money.</p>
          ) : (
            <div className="table-card">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Agreed</th>
                    <th scope="col">Received</th>
                    <th scope="col">Booking</th>
                    <th scope="col"><span className="sr-only">Record a payment</span></th>
                  </tr>
                </thead>
                <tbody>
                  {collect.map((c) => {
                    const owed = c.amountMinor - c.receivedMinor;
                    const seen = paymentsByRequest.get(c.requestId) ?? [];
                    return (
                      <tr key={c.requestId}>
                        <td>{c.reference}</td>
                        <td>{c.businessName}</td>
                        <td>{formatAmount(c.amountMinor)}</td>
                        <td>
                          {formatAmount(c.receivedMinor)}
                          {seen.length > 0 ? (
                            <>
                              <br />
                              <span className="field__helper">
                                {seen.map((p) => `${methodLabel(p.method)} ${p.externalRef}`).join(" · ")}
                              </span>
                            </>
                          ) : null}
                        </td>
                        <td>
                          <span className={`pill pill--${c.booked ? "completed" : "awaiting_quotes"}`}>
                            {c.booked ? "Booked" : owed > 0 ? `${formatAmount(owed)} to go` : "Not booked"}
                          </span>
                        </td>
                        <td>
                          {c.booked ? (
                            <span className="field__helper">Paid</span>
                          ) : (
                            <details className="disclosure">
                              <summary className="button button--ghost">Record a payment</summary>
                              <form action={recordPaymentAction} className="inline-form">
                                <input type="hidden" name="requestId" value={c.requestId} />
                                <label className="field">
                                  <span className="field__label">Amount received</span>
                                  <input
                                    name="amount" className="field__input" inputMode="decimal"
                                    placeholder={String(owed / 100)} defaultValue={String(owed / 100)}
                                  />
                                </label>
                                <label className="field">
                                  <span className="field__label">How it was paid</span>
                                  <MethodSelect />
                                </label>
                                <label className="field">
                                  <span className="field__label">Receipt or transaction reference</span>
                                  <input name="reference" className="field__input" placeholder="e.g. MM-8842193" />
                                  <span className="field__helper">
                                    This is what stops the same payment being recorded twice.
                                  </span>
                                </label>
                                <label className="field">
                                  <span className="field__label">Note (optional)</span>
                                  <input name="note" className="field__input" />
                                </label>
                                <button type="submit" className="button" formNoValidate>Record it</button>
                              </form>
                            </details>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "cases" ? (
          cases.length === 0 ? (
            <p className="empty">No payment is stuck. Money that arrives too late shows up here.</p>
          ) : (
            cases.map((c) => (
              <section key={c.id} className="staff__item">
                <h2>{c.reference}</h2>
                <p className="notice notice--error" role="status">{c.detail}</p>
                <p className="field__helper">Opened {when(c.openedAt)}</p>
                <details className="disclosure">
                  <summary className="button button--ghost">Refund the farmer</summary>
                  <form action={prepareRefundAction} className="inline-form">
                    <input type="hidden" name="requestId" value={c.requestId} />
                    <label className="field">
                      <span className="field__label">Amount to refund</span>
                      <input name="amount" className="field__input" inputMode="decimal" />
                    </label>
                    <label className="field">
                      <span className="field__label">Why</span>
                      <input name="reason" className="field__input" defaultValue={c.detail} />
                    </label>
                    <button type="submit" className="button" formNoValidate>Prepare the refund</button>
                    <p className="field__helper">
                      A refund needs a second person to approve it before any money moves.
                    </p>
                  </form>
                </details>
                <form action={resolveCaseAction} className="inline-form">
                  <input type="hidden" name="id" value={c.id} />
                  <label className="field">
                    <span className="field__label">Or close it with a note</span>
                    <input name="resolution" className="field__input" placeholder="e.g. new dates agreed with the farmer" />
                  </label>
                  <button type="submit" className="button button--ghost" formNoValidate>Close the case</button>
                </form>
              </section>
            ))
          )
        ) : null}

        {tab === "releases" ? (
          <>
            {withdrawals.length > 0 ? (
              <section className="staff__item">
                <h2>Withdrawal requests</h2>
                <p className="field__helper">Providers asking for approved money. Send it below as usual, then close the request.</p>
                <ul className="asset__faults">
                  {withdrawals.map((w) => (
                    <li key={w.id}>
                      <span className="asset__fault-text">{w.reference} · {w.businessName} · {formatAmount(w.amountMinor)}</span>
                      <form action={closePayoutRequestAction}>
                        <input type="hidden" name="id" value={w.id} />
                        <button type="submit" className="resend__button">Close</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {payable.length > 0 ? (
              <section className="staff__item">
                <h2>Ready to pay out</h2>
                <p className="field__helper">
                  The farmer has confirmed the work on these jobs. A reported job is not a confirmed one,
                  so nothing appears here on the provider&apos;s word alone.
                </p>
                <ul className="plain-list">
                  {payable.map((p) => (
                    <li key={p.requestId}>
                      <span>
                        {p.reference} · {p.businessName} · {formatAmount(p.receivedMinor)} held
                      </span>
                      <form action={preparePayoutAction}>
                        <input type="hidden" name="requestId" value={p.requestId} />
                        <button type="submit" className="button button--ghost">Prepare the payout</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {releases.length === 0 ? (
              <p className="empty">Nothing is waiting to go out.</p>
            ) : (
              releases.map((r) => (
                <section key={r.id} className="staff__item">
                  <h2>
                    {r.kind === "payout" ? "Payout" : "Refund"} · {r.reference}
                  </h2>
                  <dl className="setup__summary">
                    <dt>To</dt><dd>{r.beneficiaryLabel}</dd>
                    <dt>Amount</dt>
                    <dd>
                      {formatAmount(r.netMinor)}
                      {r.feeMinor > 0 ? (
                        <span className="field__helper"> (of {formatAmount(r.grossMinor)}, fee {formatAmount(r.feeMinor)})</span>
                      ) : null}
                    </dd>
                    {r.reason ? (<><dt>Why</dt><dd>{r.reason}</dd></>) : null}
                    <dt>Prepared</dt><dd>{when(r.preparedAt)}</dd>
                    <dt>State</dt>
                    <dd>
                      <span className={`pill pill--${r.status === "approved" ? "in_progress" : "awaiting_quotes"}`}>
                        {RELEASE_STATUS_LABEL[r.status]}
                      </span>
                    </dd>
                  </dl>

                  {r.status === "prepared" ? (
                    <form action={approveReleaseAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="button">Approve it</button>
                      <p className="field__helper">
                        Only someone other than the person who prepared it can approve it.
                      </p>
                    </form>
                  ) : (
                    <details className="disclosure">
                      <summary className="button">Record it as sent</summary>
                      <form action={markSentAction} className="inline-form">
                        <input type="hidden" name="id" value={r.id} />
                        <label className="field">
                          <span className="field__label">How it was sent</span>
                          <MethodSelect />
                        </label>
                        <label className="field">
                          <span className="field__label">Transfer reference</span>
                          <input name="reference" className="field__input" />
                        </label>
                        <button type="submit" className="button" formNoValidate>It has been sent</button>
                      </form>
                    </details>
                  )}

                  <details className="disclosure">
                    <summary className="button button--ghost">Change the amount</summary>
                    <form action={reviseReleaseAction} className="inline-form">
                      <input type="hidden" name="id" value={r.id} />
                      <label className="field">
                        <span className="field__label">New amount</span>
                        <input name="amount" className="field__input" inputMode="decimal" defaultValue={String(r.grossMinor / 100)} />
                      </label>
                      <button type="submit" className="button button--ghost" formNoValidate>Change it</button>
                      <p className="field__helper">Changing the amount withdraws any approval.</p>
                    </form>
                  </details>

                  <form action={voidReleaseAction} className="inline-form">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="reason" value="Cancelled at the finance desk" />
                    <button type="submit" className="resend__button">Cancel this release</button>
                  </form>
                </section>
              ))
            )}
          </>
        ) : null}

        {tab === "books" ? (
          <>
            <p className={`notice notice--${books.balanced ? "success" : "error"}`} role="status">
              {books.balanced
                ? "The ledger balances: every entry has its opposite."
                : "The ledger does not balance. Stop and investigate before any more money moves."}
            </p>
            <dl className="setup__summary">
              <dt>Held against live jobs</dt><dd>{formatAmount(books.heldMinor)}</dd>
              <dt>Owed to providers</dt><dd>{formatAmount(books.payableMinor)}</dd>
              <dt>Owed back to farmers</dt><dd>{formatAmount(books.refundableMinor)}</dd>
              <dt>Platform fees kept</dt><dd>{formatAmount(books.feeMinor)}</dd>
            </dl>

            {books.negativeAccounts.length > 0 ? (
              <>
                <h2>Accounts in the negative</h2>
                <p className="field__helper">
                  Money has gone out of one of these that never came in. This should never happen.
                </p>
                <ul className="plain-list">
                  {books.negativeAccounts.map((a) => (
                    <li key={a.account}><span>{a.account}</span><span>{formatAmount(a.amountMinor)}</span></li>
                  ))}
                </ul>
              </>
            ) : null}

            <h2>Money still held on a finished job</h2>
            {books.heldAfterCompletion.length === 0 ? (
              <p className="empty">Nothing. Every finished job has been settled.</p>
            ) : (
              <ul className="plain-list">
                {books.heldAfterCompletion.map((h) => {
                  const job = heldJobs.get(h.requestId) ?? null;
                  return (
                    <li key={h.requestId}>
                      <span>
                        {h.reference} · {formatAmount(h.amountMinor)}
                        {job ? <span className="field__helper"> · {JOB_STATUS_LABEL[job.status as JobStatus]}</span> : null}
                      </span>
                      <Link href="/staff/payments?tab=releases">Settle it</Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}

        <form action={signOut} className="setup__signout">
          <button type="submit" className="resend__button">Sign out</button>
        </form>
      </div>
    </main>
  );
}
