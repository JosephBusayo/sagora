import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/app/EmptyState";
import { GuestShell } from "@/components/guest/GuestShell";
import { guestRequest } from "@/lib/guest";
import { formatAmount } from "@/lib/money";
import { methodLabel } from "@/lib/payments";
import { transactionsFor } from "@/lib/settlement";
import { agreementFor } from "@/lib/quotes";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** The money on a request sent without an account, in the same columns as the farmer Payments screen. */
export default async function Page() {
  const request = await guestRequest();
  if (!request) redirect("/request/find");
  const rows = await transactionsFor("", request.id);
  const agreement = await agreementFor(request.id);
  const paid = rows.filter((t) => t.kind === "payment").reduce((n, t) => n + t.amountMinor, 0);
  return (
    <GuestShell>
      <h1 className="guest__title">Payments</h1>
      <p className="field__helper">
        For request {request.reference}. <Link href="/request/track">Back to your request</Link>
      </p>
      {agreement ? (
        <p className="field__helper">
          Agreed {formatAmount(agreement.amountMinor)} · Paid so far {formatAmount(paid)} · Still to pay {formatAmount(Math.max(0, agreement.amountMinor - paid))}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="table-card"><EmptyState icon="payments" title="No payments yet" body="Your payment records will appear here after you complete a booking" /></div>
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
                  <td>{t.id}</td>
                  <td><span>{t.label}<br /><span className="field__helper">{methodLabel(t.method) || "—"}</span></span></td>
                  <td>{formatAmount(t.amountMinor)}</td>
                  <td>{when(t.at)}</td>
                  <td><span className={`pill pill--${t.status === "Being processed" ? "in_progress" : "completed"}`}>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GuestShell>
  );
}
