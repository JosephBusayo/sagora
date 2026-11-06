import { EmptyState } from "@/components/app/EmptyState";
import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { formatAmount } from "@/lib/money";
import { methodLabel } from "@/lib/payments";
import { transactionsFor } from "@/lib/settlement";
import { Shell, PageHead } from "@/components/app/Shell";
import { Icon } from "@/components/app/Icon";
import { ModalShell } from "@/components/app/ModalShell";
import { unreadCount } from "@/lib/notifications";
import { districtLabel } from "@/lib/business";
import { bookingsForFarmer } from "@/lib/jobs";
import { LAND_ACCESS, LAND_CONDITION, landLabel } from "@/lib/land";
import { getById, serviceLabel } from "@/lib/requests";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The farmer's transactions, as the design's table lists them: Transaction ID, Type, Amount in
 * Le, Date, Status. The transaction id is the receipt reference from the payment itself, so it
 * matches the paper or the mobile money message the farmer already has.
 */
const day = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : null;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="detail-row"><span className="detail-row__label">{label}</span><span className="detail-row__value">{children}</span></div>;
}

const keyOf = (t: { kind: string; id: string }) => `${t.kind}-${t.id}`;

export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const farmer = await requireFarmer();
  const rows = await transactionsFor(farmer.id);
  const sp = await searchParams;
  // The design's Payment details window: the work the money was for, and where it stands.
  const open = rows.find((t) => keyOf(t) === sp.open);
  const request = open ? await getById(open.requestId) : null;
  const booking = open ? (await bookingsForFarmer(farmer.id)).find((b) => b.requestId === open.requestId) : undefined;

  return (
    <Shell
      crumb={{ label: "Payments", icon: "payments" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead title="Payments" subtitle="View your earnings, payout details and transactions." />
      <>
        {rows.length === 0 ? (
          <div className="table-card"><EmptyState icon="payments" title="No payments yet" body="Your payment records will appear here after you complete a booking" href="/farmer/book" action="Book a service" /></div>
        ) : (
          <div className="table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Transaction ID</th>
                  <th scope="col">Type</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Date received</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={`${t.kind}-${t.id}`}>
                    <td>
                      {t.id}
                      <br />
                      <span className="field__helper">
                        <Link href={`/farmer/requests/${t.requestId}`}>{t.reference}</Link>
                      </span>
                    </td>
                    <td>
                      {t.kind === "payment" ? "Payment" : "Refund"}
                      <br />
                      <span className="field__helper">{methodLabel(t.method) || "—"}</span>
                    </td>
                    <td>{formatAmount(t.amountMinor)}</td>
                    <td>{when(t.at)}</td>
                    <td>
                      <span className={`pill pill--${t.status === "Being processed" ? "in_progress" : "completed"}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="table__go">
                      <Link href={`/farmer/payments?open=${encodeURIComponent(keyOf(t))}`} aria-label="Payment details"><Icon name="chevron" size={24} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </>

      {open && request ? (
        <ModalShell closeHref="/farmer/payments" label="Payment details" className="modal--request">
          <div className="modal__banner" aria-hidden="true">
            <span className="banner__ring banner__outer" />
            <span className="banner__ring banner__mid" />
            <span className="banner__ring banner__inner"><Icon name="payments" size={34} /></span>
          </div>
          <article className="asset asset--plain">
            <header className="modal__head"><h2>Payment details</h2></header>
            <div className="detail-list">
              <Row label="Service">{serviceLabel(request.service)}</Row>
              <Row label="Land size">{request.acres} acres</Row>
              <Row label="Location">{request.village}, {districtLabel(request.district)}</Row>
              <Row label="Scheduled start date">{day(booking?.startDate ?? null) ?? "Not yet"}</Row>
              {request.landAccess ? <Row label="Land access">{landLabel(LAND_ACCESS, request.landAccess)}</Row> : null}
              {request.landCondition ? <Row label="Land condition">{landLabel(LAND_CONDITION, request.landCondition)}</Row> : null}
              {booking ? <Row label="Provider">{booking.businessName}</Row> : null}
              <Row label="Amount">{formatAmount(open.amountMinor)}</Row>
              <Row label="Status">
                <span className={`pill pill--${open.status === "Being processed" ? "in_progress" : "completed"}`}>{open.status}</span>
              </Row>
            </div>
            <div className="form-actions">
              <Link href="/farmer/payments" className="button">Close</Link>
            </div>
          </article>
        </ModalShell>
      ) : null}
    </Shell>
  );
}
