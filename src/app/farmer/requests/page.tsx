import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, listForFarmer, serviceLabel } from "@/lib/requests";
import { cancelRequest } from "../book/actions";

export const metadata: Metadata = { title: "My requests" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });

export default async function Page({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const farmer = await requireFarmer();
  const justCreated = (await searchParams).new;
  const rows = listForFarmer(farmer.id);

  return (
    <main className="setup">
      <div className="setup__card setup__card--wide">
        <h1 className="auth__title">My requests</h1>
        {justCreated ? (
          <p className="notice notice--success" role="status">
            Request <strong>{justCreated}</strong> sent. Keep that reference: it is how you find this
            request again. We have emailed it to you.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <>
            <p className="empty">You have not asked for any work yet.</p>
            <p style={{ textAlign: "center" }}><Link href="/farmer/book">Book a service</Link></p>
          </>
        ) : (
          <div className="table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Service</th>
                  <th scope="col">Location</th>
                  <th scope="col">Farm size</th>
                  <th scope="col">Preferred date</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/farmer/requests/${r.id}`}>{r.reference}</Link></td>
                    <td>{serviceLabel(r.service)}</td>
                    <td>{r.village}, {districtLabel(r.district)}</td>
                    <td>{r.acres} acres</td>
                    <td>{fmt(r.preferredDate)}</td>
                    <td><span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="table__actions">
                      {r.status === "awaiting_quotes" || r.status === "quotes_sent" ? (
                        <form action={cancelRequest}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className="resend__button">Withdraw</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="auth__footer"><Link href="/farmer/book">Book another service</Link> · <Link href="/farmer/home">Home</Link></p>
      </div>
    </main>
  );
}
