import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { Icon, ServiceIcon } from "@/components/app/Icon";
import { EmptyState } from "@/components/app/EmptyState";
import { FilterPill } from "@/components/app/FilterPill";
import { ModalShell } from "@/components/app/ModalShell";
import { FilterAutoSubmit } from "@/components/requests/FilterAutoSubmit";
import { districtLabel } from "@/lib/business";
import { formatAmount } from "@/lib/money";
import { serviceLabel } from "@/lib/requests";
import { unreadCount } from "@/lib/notifications";
import { bookingFor } from "@/lib/payments";
import {
  BOOKING_TABS, JOB_STATUS_LABEL, bookingsForFarmer, type JobStatus,
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

// Upcoming amber, under way blue, finished green, as the design colours a farmer's bookings.
const PILL_FARMER: Record<string, string> = { ...PILL, unscheduled: "in_progress", scheduled: "in_progress", in_progress: "completed", work_reported: "completed", completed: "quotes_sent" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="detail-row"><span className="detail-row__label">{label}</span><span className="detail-row__value">{children}</span></div>;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; open?: string }> }) {
  const farmer = await requireFarmer();
  const sp = await searchParams;
  const tab = BOOKING_TABS.find((t) => t.id === sp.tab);

  const all = await bookingsForFarmer(farmer.id);
  const rows = tab ? all.filter((b) => (tab.statuses as readonly string[]).includes(b.status)) : all;
  const open = all.find((b) => b.id === sp.open);
  const paid = open ? Boolean(await bookingFor(open.requestId)) : false;

  return (
    <Shell
      crumb={{ label: "My bookings", icon: "jobs" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead
        title="Bookings"
        subtitle="View and track your confirmed bookings"
        action={
          <form className="filters" method="get">
            <FilterPill name="tab" label="Booking state" value={tab?.id} icon="/icons/funnel.svg"
              options={[{ value: "", label: "Filter" }, ...BOOKING_TABS.map((t) => ({ value: t.id, label: t.label }))]} />
            <noscript><button type="submit" className="button button--inline">Apply</button></noscript>
            <FilterAutoSubmit />
          </form>
        }
      />

      {rows.length === 0 ? (
        <EmptyState icon="jobs" title="No bookings yet" body="Your confirmed bookings will appear here" href="/farmer/book" action="Book a service" />
      ) : (
        <div className="table-card">
          <table className="table table--requests table--headless">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Service</th>
                <th scope="col">Location</th>
                <th scope="col">Farm size</th>
                <th scope="col">Scheduled date</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td><span className="table__ref"><ServiceIcon service={b.service} /><span>{b.reference}</span></span></td>
                  <td>{serviceLabel(b.service)}</td>
                  <td>{districtLabel(b.district)}</td>
                  <td>{b.acres} acres</td>
                  <td>{fmt(b.startDate) ?? "Not yet"}</td>
                  <td><span className={`pill pill--${PILL_FARMER[b.status]}`}>{JOB_STATUS_LABEL[b.status as JobStatus]}</span></td>
                  <td className="table__go">
                    <Link href={`/farmer/bookings?${tab ? `tab=${tab.id}&` : ""}open=${b.id}`} aria-label={`Open booking ${b.reference}`}><Icon name="chevron" size={24} /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <ModalShell closeHref={tab ? `/farmer/bookings?tab=${tab.id}` : "/farmer/bookings"} label="Booking details" className="modal--request">
          <div className="modal__banner" aria-hidden="true">
            <span className="banner__ring banner__outer" />
            <span className="banner__ring banner__mid" />
            <span className="banner__ring banner__inner"><Icon name="jobs" size={34} /></span>
          </div>
          <article className="asset asset--plain">
            <header className="modal__head"><h2>Booking details</h2></header>
            <div className="detail-list">
              <Row label="Service">{serviceLabel(open.service)}</Row>
              <Row label="Land size">{open.acres} acres</Row>
              <Row label="Location">{open.village}, {districtLabel(open.district)}</Row>
              <Row label="Scheduled start date">{open.startDate ? `${fmt(open.startDate)} to ${fmt(open.endDate)}` : "The provider has not given you dates yet."}</Row>
              <Row label="Provider">{open.businessName}</Row>
              {open.amountMinor > 0 ? <Row label="Amount">{formatAmount(open.amountMinor)}</Row> : null}
              {open.assetNames.length > 0 ? <Row label="Machines">{open.assetNames.join(", ")}</Row> : null}
              <Row label="Payment"><span className={`pill pill--${paid ? "quotes_sent" : "awaiting_quotes"}`}>{paid ? "Paid" : "Not paid"}</span></Row>
              <Row label="Status"><span className={`pill pill--${PILL_FARMER[open.status]}`}>{JOB_STATUS_LABEL[open.status as JobStatus]}</span></Row>
            </div>
            {open.status === "work_reported" ? (
              <p className="notice notice--success" role="status">
                {open.businessName} says {open.reportedAcres} acres are done. Nothing is settled until you confirm.
              </p>
            ) : null}
            {open.status === "disputed" ? (
              <p className="notice notice--error" role="status">Your concern: {open.concern}</p>
            ) : null}
            <div className="form-actions">
              <Link href={`/farmer/requests/${open.requestId}`} className="button button--soft">
                {open.status === "work_reported" ? "Confirm or raise a concern" : "Open the request"}
              </Link>
              <Link href={tab ? `/farmer/bookings?tab=${tab.id}` : "/farmer/bookings"} className="button">Done</Link>
            </div>
          </article>
        </ModalShell>
      ) : null}
    </Shell>
  );
}
