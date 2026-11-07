import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/app/Shell";
import { PendingButton } from "@/components/app/PendingButton";
import { StaffShell } from "@/components/staff/StaffShell";
import { formatAmount } from "@/lib/money";
import { landSize } from "@/lib/land-size";
import { sagoraReport, testEmails } from "@/lib/sagora-report";
import { requireStaff } from "@/lib/session";
import { saveTestEmailsAction } from "../follow-up-actions";

export const metadata: Metadata = { title: "Sagora report" };
export const dynamic = "force-dynamic";

const PERIODS = [
  { id: "", label: "All time", days: null },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "7", label: "Last 7 days", days: 7 },
] as const;

function Rows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="setup__summary">
      {rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
    </dl>
  );
}

/** UC14: the business's own results, each stage counted apart. No Figma frame exists for this. */
export default async function Page({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const staff = await requireStaff();
  const { period = "" } = await searchParams;
  const chosen = PERIODS.find((p) => p.id === period) ?? PERIODS[0];
  const r = await sagoraReport(chosen.days);
  const tests = await testEmails();
  const count = (n: number) => n.toLocaleString("en-GB");
  return (
    <StaffShell staff={staff} crumb={{ label: "Sagora report", icon: "reports" }}>
      <PageHead title="Sagora report" subtitle="Requests, work and money across every provider. Test activity is left out." />
      <nav className="queue-nav" aria-label="Period">
        {PERIODS.map((p) => (
          <Link key={p.id} href={p.id ? `/staff/report?period=${p.id}` : "/staff/report"} aria-current={p.id === chosen.id ? "page" : undefined}>{p.label}</Link>
        ))}
      </nav>
      <section className="staff__item">
        <h2>Work</h2>
        <Rows rows={[
          ["Requests", count(r.requests)],
          ["Quotes accepted", count(r.accepted)],
          ["Paid and booked", count(r.booked)],
          ["Jobs started", count(r.started)],
          ["Started, not finished", count(r.startedNotFinished)],
          ["Confirmed by the farmer", count(r.completed)],
          ["Land worked and confirmed", landSize(r.acresDelivered)],
          ["Repeat customers", count(r.repeatCustomers)],
        ]} />
      </section>
      <section className="staff__item">
        <h2>Money</h2>
        <Rows rows={[
          ["Paid by farmers", formatAmount(r.farmerPaidMinor)],
          ["Sagora fees collected", formatAmount(r.feesMinor)],
          ["Sent to providers", formatAmount(r.paidToProvidersMinor)],
          ["Refunded to farmers", formatAmount(r.refundedMinor)],
          ["Payouts and refunds not yet sent", count(r.moneyWaiting)],
          ["Open payment and job cases", count(r.openCases)],
        ]} />
        <p className="field__helper">Sagora&rsquo;s revenue is the fee only. Money sent to providers is theirs.</p>
      </section>
      <section className="staff__item">
        <h2>Requests not served</h2>
        <Rows rows={r.notServed.map((x) => [x.reason, count(x.count)] as const)} />
      </section>
      <section className="staff__item">
        <h2>Test accounts</h2>
        <p className="field__helper">
          {r.excludedRequests} {r.excludedRequests === 1 ? "request is" : "requests are"} left out because they belong to these emails.
          Payments made with a Monime test token are always left out.
        </p>
        {staff.role === "admin" ? (
          <form action={saveTestEmailsAction} className="form-soft queue__form">
            <div className="field">
              <label className="field__label" htmlFor="test-emails">Test emails, separated by commas</label>
              <div className="field__box field__box--area">
                <textarea id="test-emails" name="emails" className="field__input" rows={2} defaultValue={tests.join(", ")} />
              </div>
            </div>
            <PendingButton className="button button--inline">Save</PendingButton>
          </form>
        ) : <p className="field__helper">{tests.length ? tests.join(", ") : "None set."}</p>}
      </section>
    </StaffShell>
  );
}
