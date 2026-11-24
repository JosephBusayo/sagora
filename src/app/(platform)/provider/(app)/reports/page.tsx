import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { EmptyState } from "@/components/app/EmptyState";
import { formatAmount } from "@/lib/money";
import { serviceLabel } from "@/lib/requests";
import { kindLabel } from "@/lib/equipment";
import { reportFor } from "@/lib/reports";
import { reconciles, revenueByMachine } from "@/lib/revenue";
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
  // A14: revenue per machine, net of fees and attributable refunds. Only with money access, the
  // same as every other figure in Leones on this screen.
  const revenue = money ? await revenueByMachine(business.id) : null;
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

      {/* A14. Settled payouts only: an accepted price is not revenue and a confirmed booking is not
          revenue, because either can still become a refund. The unallocated row is the handover's
          explicit ask — "anything not allocated must be shown and excluded rather than quietly
          spread" — so it is a row of its own rather than a rounding adjustment nobody can see. */}
      {revenue ? (
        <section className="home-section">
          <div className="home-section__head">
            <h2 className="home-section__title">What each machine earned</h2>
          </div>
          <div className="table-card">
            {revenue.machines.length === 0 ? (
              <EmptyState icon="payments" title="Nothing settled yet"
                body="Once a job has been paid out, what each machine earned shows here." />
            ) : (
              <>
                <table className="table table--report">
                  <thead>
                    <tr>
                      <th scope="col">Equipment</th>
                      <th scope="col">Jobs</th>
                      <th scope="col">Share of payouts</th>
                      <th scope="col">Refunds against it</th>
                      <th scope="col">Earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenue.machines.map((m) => (
                      <tr key={m.equipmentId}>
                        <td>
                          {m.name}
                          {m.identifier ? <span className="table__muted"> · {m.identifier}</span> : null}
                        </td>
                        <td>{m.jobs.toLocaleString("en-GB")}</td>
                        <td>
                          {formatAmount(m.netMinor)}
                          {/* Said plainly, because an even split between a tractor and a plough is a
                              guess and somebody deciding where to put their money should know it. */}
                          {m.assumed ? <span className="table__muted"> · split evenly</span> : null}
                        </td>
                        <td>{m.refundMinor ? formatAmount(m.refundMinor) : "None"}</td>
                        <td><strong>{formatAmount(m.earnedMinor)}</strong></td>
                      </tr>
                    ))}
                    {revenue.unallocatedMinor !== 0 ? (
                      <tr>
                        <td colSpan={4}>
                          Not allocated
                          <span className="field__helper">
                            Paid out on jobs where the shares you set do not account for all of it. It is in
                            no machine&rsquo;s total.
                          </span>
                        </td>
                        <td><strong>{formatAmount(revenue.unallocatedMinor)}</strong></td>
                      </tr>
                    ) : null}
                    <tr>
                      <td colSpan={4}><strong>Paid out to you</strong></td>
                      <td><strong>{formatAmount(revenue.totalEarnedMinor)}</strong></td>
                    </tr>
                  </tbody>
                </table>
                <p className="field__helper">
                  Across {revenue.jobs.toLocaleString("en-GB")} settled {revenue.jobs === 1 ? "job" : "jobs"},
                  after Sagora&rsquo;s fee of {formatAmount(revenue.feeMinor)}.
                  {" "}Machines plus anything not allocated come to the total exactly
                  {reconciles(revenue) ? "" : " — but they do not here, which is a bug worth reporting"}.
                </p>
              </>
            )}
          </div>
        </section>
      ) : null}

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
