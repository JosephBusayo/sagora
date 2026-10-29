import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { Icon } from "@/components/app/Icon";
import { districtLabel } from "@/lib/business";
import { formatAmount } from "@/lib/money";
import { serviceLabel } from "@/lib/requests";
import { unreadCount } from "@/lib/notifications";
import { bookingFor } from "@/lib/payments";
import {
  BOOKING_TABS, JOB_STATUS_LABEL, bookingsForFarmer, type BookingTab, type JobStatus,
} from "@/lib/jobs";

export const metadata: Metadata = { title: "My bookings" };
export const dynamic = "force-dynamic";

const fmt = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : null;

const PILL: Record<string, string> = {
  unscheduled: "awaiting_quotes",
  scheduled: "quotes_sent",
  in_progress: "in_progress",
  work_reported: "in_progress",
  completed: "completed",
  disputed: "cancelled",
  cancelled: "cancelled",
};

const EMPTY: Record<BookingTab, string> = {
  upcoming: "Nothing booked yet. Accept a quote on a request and it will appear here.",
  in_progress: "No work is under way right now.",
  completed: "Nothing finished yet.",
  cancelled: "Nothing has been cancelled.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const farmer = await requireFarmer();
  const asked = (await searchParams).tab;
  const tab: BookingTab = BOOKING_TABS.some((t) => t.id === asked) ? (asked as BookingTab) : "upcoming";

  const all = await bookingsForFarmer(farmer.id);
  const statuses = BOOKING_TABS.find((t) => t.id === tab)!.statuses as readonly string[];
  const rows = all.filter((b) => statuses.includes(b.status));
  // Whether each job is paid is a query, and a component cannot await inside its own JSX,
  // so the answers are gathered before anything is rendered.
  const paidByRequest = new Map(
    await Promise.all(rows.map(async (b) => [b.requestId, Boolean(await bookingFor(b.requestId))] as const)),
  );
  const count = (t: (typeof BOOKING_TABS)[number]) =>
    all.filter((b) => (t.statuses as readonly string[]).includes(b.status)).length;

  return (
    <Shell
      crumb={{ label: "My bookings", icon: "jobs" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead
        title="My bookings"
        subtitle="Work you have agreed to, and where each job has got to."
      />

      <nav className="tabs tabs--page" aria-label="Booking states">
        {BOOKING_TABS.map((t) => (
          <Link
            key={t.id}
            href={`/farmer/bookings?tab=${t.id}`}
            className={`tab${t.id === tab ? " tab--on" : ""}`}
            aria-current={t.id === tab ? "page" : undefined}
          >
            {t.label}{count(t) > 0 ? ` (${count(t)})` : ""}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="table-card">
          <p className="empty">{EMPTY[tab]}</p>
          {tab === "upcoming" ? (
            <p style={{ textAlign: "center", marginTop: -20, paddingBottom: 30 }}>
              <Link href="/farmer/book">Book a service</Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="equipment-grid">
          {rows.map((b) => {
            const paid = paidByRequest.get(b.requestId) ?? false;
            return (
              <article key={b.id} className="asset">
                <div className="asset__head">
                  <span className="request-icon" aria-hidden="true">
                    <Icon name={b.service === "harvesting" ? "quotes" : "equipment"} size={22} />
                  </span>
                  <div className="asset__title">
                    <h3>{b.reference}</h3>
                    <p>{serviceLabel(b.service)} · {b.acres} acres · {b.village}, {districtLabel(b.district)}</p>
                  </div>
                </div>

                <p className="asset__state">
                  <span className={`pill pill--${PILL[b.status]}`}>{JOB_STATUS_LABEL[b.status as JobStatus]}</span>
                  <span className={`pill pill--${paid ? "completed" : "awaiting_quotes"}`}>
                    {paid ? "Paid" : "Not paid"}
                  </span>
                </p>

                <p className="asset__notes">
                  <strong>{b.businessName}</strong>
                  {b.businessPhone ? ` · ${b.businessPhone}` : ""}
                  {b.amountMinor > 0 ? ` · ${formatAmount(b.amountMinor)}` : ""}
                </p>

                {b.startDate ? (
                  <p className="asset__notes">{fmt(b.startDate)} to {fmt(b.endDate)}</p>
                ) : (
                  <p className="asset__notes">The provider has not given you dates yet.</p>
                )}

                {b.assetNames.length > 0 ? (
                  <p className="asset__notes">Machines: {b.assetNames.join(", ")}</p>
                ) : null}

                {b.status === "work_reported" ? (
                  <p className="notice notice--success" role="status">
                    {b.businessName} says {b.reportedAcres} acres are done. Nothing is settled until you confirm.
                  </p>
                ) : null}
                {b.status === "disputed" ? (
                  <p className="notice notice--error" role="status">Your concern: {b.concern}</p>
                ) : null}

                <div className="setup__buttons">
                  <Link href={`/farmer/requests/${b.requestId}`} className="button button--ghost button--inline">
                    {b.status === "work_reported" ? "Confirm or raise a concern" : "Open the request"}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
