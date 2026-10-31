import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { Shell } from "@/components/app/Shell";
import { EmptyState } from "@/components/app/EmptyState";
import { Icon, ServiceIcon } from "@/components/app/Icon";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, browse, serviceLabel } from "@/lib/requests";
import { listForBusiness as listQuotes, isExpired } from "@/lib/quotes";
import { atRiskAssets, listJobs } from "@/lib/jobs";
import { listAssets, unavailableReason } from "@/lib/equipment";
import { unreadCount } from "@/lib/notifications";
import { greeting, todayLong } from "@/lib/greeting";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/** The three cards the design offers from the dashboard, with the designer's own wording. */
const ACTIONS: { href: string; art: string; title: string; body: string }[] = [
  { href: "/provider/requests", art: "/home/home-requests.svg", title: "Requests",
    body: "View farm service requests & find work that matches your services." },
  { href: "/provider/jobs", art: "/home/home-schedule.svg", title: "Manage your schedule",
    body: "Check upcoming jobs and review equipment and operator availability." },
  { href: "/provider/equipment", art: "/home/home-equipment.svg", title: "Manage equipments",
    body: "View your registered equipment and update its availability or condition." },
];

const fmtYear = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The provider's home screen.
 *
 * Every number is counted from the same data the other screens use, never stored separately
 * and never estimated.
 */
export default async function Page() {
  const { user, business } = await requireWorkspace();
  const firstName = user.name.trim().split(/\s+/)[0];

  const quotes = await listQuotes(business.id);
  const jobs = await listJobs(business.id);
  const assets = await listAssets(business.id);

  // Requests in this provider's districts, and those they have not quoted on yet.
  const area = await browse({}, 1, business);
  const unquoted = area.rows.filter((r) => !quotes.some((q) => q.requestId === r.id));
  const recent = area.rows.slice(0, 4);

  const expired = quotes.filter(isExpired);
  const pending = jobs.filter((j) => ["unscheduled", "scheduled", "in_progress"].includes(j.status));
  const disputed = jobs.filter((j) => j.status === "disputed");
  const faulty = assets.filter((a) => a.status === "active" && unavailableReason(a) !== null);
  // One query per job, so they are gathered together rather than inside the render.
  const atRisk = (
    await Promise.all(jobs.map(async (j) => (await atRiskAssets(business.id, j)).map((a) => ({ job: j, ...a }))))
  ).flat();

  const OVERVIEW = [
    { label: "Total requests", value: area.total, href: "/provider/requests", badge: unquoted.length > 0 ? `${unquoted.length} new requests` : null },
    { label: "All jobs", value: jobs.length, href: "/provider/jobs", badge: pending.length > 0 ? `${pending.length} pending` : null },
  ];

  // Things that are actually wrong, worst first. An empty list is the good outcome.
  const attention: { text: string; href: string; bad: boolean }[] = [
    ...disputed.map((j) => ({ text: `${j.reference}: the farmer raised a concern`, href: "/provider/jobs", bad: true })),
    ...atRisk.map((a) => ({ text: `${a.job.reference}: ${a.name} is ${a.why.toLowerCase()}`, href: "/provider/jobs", bad: true })),
    ...expired.map((q) => ({ text: `${q.reference}: your quote has expired`, href: "/provider/quotes", bad: false })),
    ...faulty.map((a) => ({ text: `${a.name} is not available for work`, href: "/provider/equipment", bad: false })),
  ];

  return (
    <Shell crumb={{ label: "Dashboard", icon: "home" }} user={{ name: user.name }} unread={await unreadCount(user)}>
      <div className="greeting">
        <p className="greeting__date">{todayLong()}</p>
        <h1 className="greeting__title">{greeting()}, {firstName}</h1>
        <p className="greeting__sub">Here&rsquo;s what&rsquo;s happening with your business today</p>
      </div>

      {/* The three things the design offers a provider from here, in its words and pictures. */}
      <div className="home-cards home-cards--three home-section">
        {ACTIONS.map((a) => (
          <Link key={a.href} href={a.href} className="home-card home-card--art">
            <span className="home-card__text">
              <strong>{a.title}</strong>
              <span>{a.body}</span>
            </span>
            <img src={a.art} alt="" width={90} height={66} />
          </Link>
        ))}
      </div>

      <section className="home-section">
        <div className="home-section__head"><h2 className="home-section__title">Business overview</h2></div>
        <div className="overview">
          {OVERVIEW.map((o) => (
            <Link key={o.label} href={o.href} className="overview__card">
              <span className="overview__icon" aria-hidden="true"><img src="/icons/fileq.svg" alt="" width={24} height={24} /></span>
              <span className="overview__text">
                <span>{o.label}</span>
                <strong>{o.value.toLocaleString("en-GB")}</strong>
              </span>
              {o.badge ? <span className="overview__badge">{o.badge}</span> : null}
              <Icon name="arrowOut" size={24} />
            </Link>
          ))}
        </div>
      </section>

      {/* Not in the design. It only shows when something is wrong, so a quiet day matches it. */}
      {attention.length > 0 ? (
        <section className="panel panel--wide home-section">
          <h2 className="quotes__heading">Needs attention</h2>
          <ul className="plain-list">
            {attention.map((a, i) => (
              <li key={i} className={a.bad ? "plain-list__bad" : undefined}>
                <span>{a.text}</span>
                <Link href={a.href}>Open</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="home-section">
        <div className="home-section__head">
          <h2 className="home-section__title">Requests overview</h2>
          <Link href="/provider/requests" className="home-section__more">See all <Icon name="arrowOut" size={24} /></Link>
        </div>
        {recent.length === 0 ? (
          <div className="table-card"><EmptyState icon="requests" body="No requests in your area yet." /></div>
        ) : (
          <div className="table-card">
            <table className="table table--requests">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Service</th>
                  <th scope="col">Location</th>
                  <th scope="col">Farm size</th>
                  <th scope="col">Preferred date</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="table__ref">
                        <ServiceIcon service={r.service} />
                        <span>{r.reference}</span>
                      </span>
                    </td>
                    <td>{serviceLabel(r.service)}</td>
                    <td>{districtLabel(r.district)}</td>
                    <td>{r.acres} acres</td>
                    <td>{fmtYear(r.preferredDate)}</td>
                    <td><span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="table__go">
                      <Link href={`/provider/requests?open=${r.reference}`} aria-label={`Open request ${r.reference}`}><Icon name="chevron" size={24} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
