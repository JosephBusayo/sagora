import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { formatAmount } from "@/lib/money";
import { methodLabel } from "@/lib/payments";
import { transactionsFor } from "@/lib/settlement";
import { Shell, PageHead } from "@/components/app/Shell";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The farmer's transactions, as the design's table lists them: Transaction ID, Type, Amount in
 * Le, Date, Status. The transaction id is the receipt reference from the payment itself, so it
 * matches the paper or the mobile money message the farmer already has.
 */
export default async function Page() {
  const farmer = await requireFarmer();
  const rows = await transactionsFor(farmer.id);

  return (
    <Shell
      crumb={{ label: "Payments", icon: "payments" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead title="Payments" subtitle="Every payment you have made and every refund sent back to you." />
      <>
        {rows.length === 0 ? (
          <>
            <p className="empty">
              <strong className="empty__title">No payments yet</strong>
              <span className="empty__body">Your payment records will appear here after you complete a booking</span>
            </p>
            <p style={{ textAlign: "center" }}><Link href="/farmer/requests">See my requests</Link></p>
          </>
        ) : (
          <div className="table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Transaction ID</th>
                  <th scope="col">Type</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </>
    </Shell>
  );
}
