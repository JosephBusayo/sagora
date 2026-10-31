import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { Shell } from "@/components/app/Shell";
import { Icon, type IconName } from "@/components/app/Icon";
import { districtLabel } from "@/lib/business";
import { formatAmount } from "@/lib/money";
import { browse, serviceLabel } from "@/lib/requests";
import { listForBusiness as listQuotes, isExpired } from "@/lib/quotes";
import { atRiskAssets, listJobs } from "@/lib/jobs";
import { listAssets, unavailableReason } from "@/lib/equipment";
import { earningsFor } from "@/lib/settlement";
import { unreadCount } from "@/lib/notifications";
import { greeting, todayLong } from "@/lib/greeting";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/** The three cards the design offers from the dashboard, with the designer's own wording. */
const ACTIONS: { href: string; icon: IconName; title: string; body: string }[] = [
  { href: "/provider/requests", icon: "requests", title: "Requests",
    body: "View farm service requests & find work that matches your services." },
  { href: "/provider/jobs", icon: "jobs", title: "Manage your schedule",
    body: "Check upcoming jobs and review equipment and operator availability." },
  { href: "/provider/equipment", icon: "equipment", title: "Manage equipments",
    body: "View your registered equipment and update its availability or condition." },
];

const fmt = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : null;

/**
 * The provider's home screen.
 *
 * It answers one question — what needs doing today — rather than showing numbers for their own
 * sake. Every row here is something the provider can act on, and every number is counted from
 * the same data the other screens use, never stored separately and never estimated.
 */
export default async function Page() {
  const { user, business } = await requireWorkspace();
  const firstName = user.name.trim().split(/\s+/)[0];

  const quotes = await listQuotes(business.id);
  const jobs = await listJobs(business.id);
  const assets = await listAssets(business.id);
  const money = await earningsFor(business.id);

  // Requests in this provider's districts that they have not quoted on yet.
  const open = (await browse({}, 1, business)).rows.filter(
    (r) => !quotes.some((q) => q.requestId === r.id),
  );

  const waiting = quotes.filter((q) => q.status === "sent" && !isExpired(q));
  const expired = quotes.filter(isExpired);
  const toSchedule = jobs.filter((j) => j.status === "unscheduled");
  const toReport = jobs.filter((j) => ["scheduled", "in_progress"].includes(j.status));
  const awaitingFarmer = jobs.filter((j) => j.status === "work_reported");
  const disputed = jobs.filter((j) => j.status === "disputed");
  const faulty = assets.filter((a) => a.status === "active" && unavailableReason(a) !== null);
  // One query per job, so they are gathered together rather than inside the render.
  const atRisk = (
    await Promise.all(jobs.map(async (j) => (await atRiskAssets(business.id, j)).map((a) => ({ job: j, ...a }))))
  ).flat();

  const owedToYou = money.reduce(
    (n, m) => n + (m.release && m.release.status !== "paid" ? m.release.netMinor : 0),
    0,
  );

  const tiles: { icon: IconName; value: string; label: string; href: string }[] = [
    { icon: "requests", value: String(open.length), label: "Requests you have not quoted", href: "/provider/requests" },
    { icon: "quotes", value: String(waiting.length), label: "Quotes waiting on a farmer", href: "/provider/quotes" },
    { icon: "jobs", value: String(toSchedule.length + toReport.length), label: "Jobs needing you", href: "/provider/jobs" },
    { icon: "payments", value: formatAmount(owedToYou), label: "Money on its way to you", href: "/provider/payments" },
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

      {/* The three things the design offers a provider from here, in its words. */}
      <div className="home-cards home-cards--three home-section">
        {ACTIONS.map((a) => (
          <Link key={a.href} href={a.href} className="home-card">
            <span className="home-card__icon" aria-hidden="true"><Icon name={a.icon} size={20} /></span>
            <span className="home-card__text">
              <strong>{a.title}</strong>
              <span>{a.body}</span>
            </span>
            <Icon name="chevron" size={24} />
          </Link>
        ))}
      </div>

      <div className="money-tiles">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="money-tile money-tile--link">
            <span className="money-tile__icon" aria-hidden="true"><Icon name={t.icon} size={20} /></span>
            <p className="money-tile__value">{t.value}</p>
            <p className="money-tile__label">{t.label}</p>
          </Link>
        ))}
      </div>

      <section className="panel panel--wide">
        <h2 className="quotes__heading">Needs attention</h2>
        {attention.length === 0 ? (
          <p className="field__helper">Nothing is wrong. No concerns, no machines out of action, no expired quotes.</p>
        ) : (
          <ul className="plain-list">
            {attention.map((a, i) => (
              <li key={i} className={a.bad ? "plain-list__bad" : undefined}>
                <span>{a.text}</span>
                <Link href={a.href}>Open</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="dash-cols">
        <section className="panel">
          <h2 className="quotes__heading">Work to do</h2>
          {toSchedule.length === 0 && toReport.length === 0 && awaitingFarmer.length === 0 ? (
            <p className="field__helper">Nothing booked. New requests appear on the Requests screen.</p>
          ) : (
            <ul className="plain-list">
              {toSchedule.map((j) => (
                <li key={j.id}>
                  <span>{j.reference} · {serviceLabel(j.service)} · {j.acres} acres</span>
                  <Link href="/provider/jobs">Schedule it</Link>
                </li>
              ))}
              {toReport.map((j) => (
                <li key={j.id}>
                  <span>
                    {j.reference} · {serviceLabel(j.service)}
                    {j.startDate ? ` · ${fmt(j.startDate)} to ${fmt(j.endDate)}` : ""}
                  </span>
                  <Link href="/provider/jobs">Report the work</Link>
                </li>
              ))}
              {awaitingFarmer.map((j) => (
                <li key={j.id}>
                  <span>{j.reference} · waiting for the farmer to confirm</span>
                  <Link href="/provider/jobs">Open</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2 className="quotes__heading">Requests you could quote</h2>
          {open.length === 0 ? (
            <p className="field__helper">
              Nothing new in {districtLabel(business.district)} right now.
            </p>
          ) : (
            <ul className="plain-list">
              {open.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <span>
                    {r.reference} · {serviceLabel(r.service)} · {r.acres} acres · {r.village}
                  </span>
                  <Link href="/provider/requests">Quote it</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
