import { PendingButton } from "@/components/app/PendingButton";
import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, listForFarmer, serviceLabel } from "@/lib/requests";
import { cancelRequest } from "../book/actions";
import { Shell, PageHead } from "@/components/app/Shell";
import { Pager, pageOf } from "@/components/app/Pager";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "My requests" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });

export default async function Page({ searchParams }: { searchParams: Promise<{ new?: string; page?: string }> }) {
  const farmer = await requireFarmer();
  const sp = await searchParams;
  const justCreated = sp.new;
  const { rows, page, pages } = pageOf(await listForFarmer(farmer.id), sp.page);

  return (
    <Shell
      crumb={{ label: "My requests", icon: "requests" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead title="Requests" subtitle="All requests you’ve sent out to service providers" />
      <>
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
                          <PendingButton confirm="Withdraw this request? Providers will no longer see it." className="resend__button">Withdraw</PendingButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pages={pages} path="/farmer/requests" />
      </>
    </Shell>
  );
}
