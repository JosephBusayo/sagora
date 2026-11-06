import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { EmptyState } from "@/components/app/EmptyState";
import { formatAmount } from "@/lib/money";
import { serviceLabel } from "@/lib/requests";
import { kindLabel } from "@/lib/equipment";
import { reportFor } from "@/lib/reports";
import { landSize } from "@/lib/land-size";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const acres = (v: number) => landSize(v);

// Not in the design: there is no Reports frame, so this uses the dashboard's overview cards and the tables.
export default async function Page() {
  const { user, business, permission } = await requireWorkspace();
  const r = await reportFor(business.id);
  // Money stays with full access, the same as the Payments screen.
  const money = permission === "full_access";
  const winRate = r.quotesSent ? Math.round((r.quotesWon / r.quotesSent) * 100) : 0;

  const cards = [
    { label: "Quotes sent", value: r.quotesSent.toLocaleString("en-GB") },
    { label: "Quotes accepted", value: `${r.quotesWon.toLocaleString("en-GB")}`, badge: r.quotesSent ? `${winRate}% accepted` : null },
    { label: "Jobs completed", value: r.jobsDone.toLocaleString("en-GB"), badge: r.jobsOpen ? `${r.jobsOpen} in progress` : null },
    { label: "Land worked", value: acres(r.acresDone) },
    ...(money
      ? [
          { label: "Total agreed", value: formatAmount(r.agreedMinor) },
          { label: "Paid to you", value: formatAmount(r.paidOutMinor) },
        ]
      : []),
  ];

  return (
    <Shell crumb={{ label: "Reports", icon: "reports" }} user={{ name: user.name }}>
      <PageHead title="Reports" subtitle="See how your business is doing across quotes, jobs and equipment." />

      <section className="home-section">
        <div className="home-section__head"><h2 className="home-section__title">Business overview</h2></div>
        <div className="overview">
          {cards.map((c) => (
            <div key={c.label} className="overview__card">
              <span className="overview__icon" aria-hidden="true"><img src="/icons/fileq.svg" alt="" width={24} height={24} /></span>
              <span className="overview__text">
                <span>{c.label}</span>
                <strong>{c.value}</strong>
              </span>
              {c.badge ? <span className="overview__badge">{c.badge}</span> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section__head"><h2 className="home-section__title">Work by service</h2></div>
        <div className="table-card">
          {r.byService.length === 0 ? (
            <EmptyState icon="reports" title="No work yet" body="Once a farmer accepts one of your quotes, the work will show here." />
          ) : (
            <table className="table table--report">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Jobs</th>
                  <th scope="col">Land size</th>
                  {money ? <th scope="col">Agreed</th> : null}
                </tr>
              </thead>
              <tbody>
                {r.byService.map((s) => (
                  <tr key={s.service}>
                    <td>{serviceLabel(s.service)}</td>
                    <td>{s.jobs.toLocaleString("en-GB")}</td>
                    <td>{acres(s.acres)}</td>
                    {money ? <td>{formatAmount(s.agreedMinor)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section__head"><h2 className="home-section__title">Equipment use</h2></div>
        <div className="table-card">
          {r.byMachine.length === 0 ? (
            <EmptyState icon="equipment" title="No equipment yet" body="Add your equipment to see how often each one is used." href="/provider/equipment" action="Go to equipment" />
          ) : (
            <table className="table table--report">
              <thead>
                <tr>
                  <th scope="col">Equipment</th>
                  <th scope="col">Type</th>
                  <th scope="col">Jobs</th>
                  <th scope="col">Open faults</th>
                </tr>
              </thead>
              <tbody>
                {r.byMachine.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}{m.status === "retired" ? <span className="table__muted"> (Retired)</span> : null}</td>
                    <td>{kindLabel(m.kind)}</td>
                    <td>{m.jobs.toLocaleString("en-GB")}</td>
                    <td>{m.openFaults ? <span className="pill pill--cancelled">{m.openFaults}</span> : "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </Shell>
  );
}
