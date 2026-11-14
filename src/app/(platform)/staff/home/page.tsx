import type { Metadata } from "next";
import Link from "next/link";
import { StaffShell } from "@/components/staff/StaffShell";
import { Icon, type IconName } from "@/components/app/Icon";
import { requireStaff } from "@/lib/session";
import { greeting, todayLong } from "@/lib/greeting";
import { waitingOnStaff } from "@/lib/staff-waiting";
import { pendingChanges } from "@/lib/coverage";
import { sagoraReport } from "@/lib/sagora-report";
import { formatAmount } from "@/lib/money";
import { landSize } from "@/lib/land-size";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/** The quick ways in, in the order a coordinator's day tends to run. */
const ACTIONS: { href: string; label: string; body: string; icon: IconName; finance?: boolean }[] = [
  { href: "/staff/providers", label: "Review providers", body: "Approve, send back or reject a new business", icon: "store" },
  { href: "/staff/requests", label: "Take a call", body: "Write down a request from a farmer on the phone", icon: "requests" },
  { href: "/staff/follow-ups", label: "Follow-ups", body: "What is waiting, who owns it and when it is due", icon: "jobs" },
  { href: "/staff/payments", label: "Payments", body: "Cases, disputes and money going out", icon: "payments", finance: true },
  { href: "/staff/outbox", label: "Notification queue", body: "Emails waiting, sent or given up on", icon: "quotes" },
  { href: "/staff/report", label: "Sagora report", body: "How the whole platform is doing", icon: "reports" },
];

/**
 * The staff home. The farmer and the provider each open on a screen that says what is going on
 * and what to do next; staff used to open straight onto Provider review, which is one queue out
 * of several. This counts every queue in one place and points at it.
 *
 * Nothing here is new data: each line is a screen that already exists, counted.
 */
export default async function Page() {
  const staff = await requireStaff();
  const finance = staff.role === "admin" || staff.financeAccess !== false;
  const [waiting, changes, report] = await Promise.all([waitingOnStaff(), pendingChanges(), sagoraReport(30)]);

  // Money out is only shown to whoever may act on it, so the count matches what they can open.
  const queues = waiting.items.filter((i) => finance || !i.href.startsWith("/staff/payments"));
  const needsAction = queues.filter((i) => i.count > 0);
  const firstName = (staff.name || staff.email).trim().split(/\s+/)[0];

  const figures = [
    { label: "Requests", value: report.requests.toLocaleString("en-GB") },
    { label: "Booked", value: report.booked.toLocaleString("en-GB") },
    { label: "Completed", value: report.completed.toLocaleString("en-GB") },
    { label: "Land worked", value: landSize(report.acresDelivered) },
    ...(finance ? [{ label: "Fees earned", value: formatAmount(report.feesMinor) }] : []),
  ];

  return (
    <StaffShell staff={staff} crumb={{ label: "Home", icon: "home" }}>
      <div className="greeting">
        <p className="greeting__date">{todayLong()}</p>
        <h1 className="greeting__title">{greeting()}, {firstName}</h1>
        <p className="greeting__sub">
          {needsAction.length === 0
            ? "Nothing is waiting on you right now."
            : `${waiting.total.toLocaleString("en-GB")} ${waiting.total === 1 ? "thing needs" : "things need"} someone to look at ${waiting.total === 1 ? "it" : "them"}.`}
        </p>
      </div>

      {/* What is waiting, loudest first. Queues with nothing in them are left out rather than
          listed as zeros: an empty queue is not work, and reading it as work wastes the glance. */}
      {needsAction.length > 0 ? (
        <section className="home-section">
          <div className="home-section__head"><h2 className="home-section__title">Waiting on you</h2></div>
          <div className="home-cards home-cards--three">
            {needsAction.map((item) => (
              <Link key={item.id} href={item.href} className="home-card">
                <span className="home-card__count" aria-hidden="true">{item.count}</span>
                <span className="home-card__text">
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </span>
                <Icon name="chevron" size={24} />
              </Link>
            ))}
            {changes.length > 0 ? (
              <Link href="/staff/providers" className="home-card">
                <span className="home-card__count" aria-hidden="true">{changes.length}</span>
                <span className="home-card__text">
                  <strong>New districts to check</strong>
                  <span>Approved providers asking to work somewhere new.</span>
                </span>
                <Icon name="chevron" size={24} />
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="home-section">
        <div className="home-section__head"><h2 className="home-section__title">Quick actions</h2></div>
        <div className="home-cards home-cards--three">
          {ACTIONS.filter((a) => finance || !a.finance).map((a) => (
            <Link key={a.href} href={a.href} className="home-card">
              <span className="home-card__icon" aria-hidden="true"><Icon name={a.icon} size={20} /></span>
              <span className="home-card__text">
                <strong>{a.label}</strong>
                <span>{a.body}</span>
              </span>
              <Icon name="chevron" size={24} />
            </Link>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="home-section__head">
          <h2 className="home-section__title">The last 30 days</h2>
          <Link href="/staff/report" className="home-section__more">See all <Icon name="arrowOut" size={24} /></Link>
        </div>
        <div className="overview">
          {figures.map((f) => (
            <div key={f.label} className="overview__card">
              <span className="overview__icon" aria-hidden="true"><img src="/icons/fileq.svg" alt="" width={24} height={24} /></span>
              <span className="overview__text">
                <span>{f.label}</span>
                <strong>{f.value}</strong>
              </span>
            </div>
          ))}
        </div>
      </section>
    </StaffShell>
  );
}
