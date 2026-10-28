import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { formatAmount } from "@/lib/money";
import { methodLabel } from "@/lib/payments";
import { transactionsFor } from "@/lib/settlement";

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
  const rows = transactionsFor(farmer.id);

  return (
    <main className="setup">
      <div className="setup__card setup__card--wide">
        <h1 className="auth__title">Payments</h1>
        <p className="auth__subtitle">
          Every payment you have made and every refund sent back to you.
        </p>

        {rows.length === 0 ? (
          <>
            <p className="empty">
              You have not paid for any work yet. A payment appears here once you accept a quote and pay for it.
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

        <p className="auth__footer">
          <Link href="/farmer/home">Back to home</Link>
        </p>
      </div>
    </main>
  );
}
