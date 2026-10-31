import { Icon, ServiceIcon } from "@/components/app/Icon";
import { EmptyState } from "@/components/app/EmptyState";
import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, listForFarmer, serviceLabel } from "@/lib/requests";
import { Shell, PageHead } from "@/components/app/Shell";
import { Pager, pageOf } from "@/components/app/Pager";
import { unreadCount } from "@/lib/notifications";

const BOOK = [
  { service: "ploughing", title: "Book ploughing service", body: "Prepare your land for planting" },
  { service: "harvesting", title: "Book harvesting service", body: "Harvest your crops efficiently" },
];

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
        <div className="home-cards home-cards--two home-cards--tight">
          {BOOK.map((b) => (
            <Link key={b.service} href={`/farmer/book?service=${b.service}`} className="home-card">
              <ServiceIcon service={b.service} />
              <span className="home-card__text"><strong>{b.title}</strong><span>{b.body}</span></span>
              <Icon name="chevron" size={24} />
            </Link>
          ))}
        </div>
        {justCreated ? (
          <p className="notice notice--success" role="status">
            Request <strong>{justCreated}</strong> sent. Keep that reference: it is how you find this
            request again. We have emailed it to you.
          </p>
        ) : null}

        <h2 className="home-section__title home-section__title--list">My requests</h2>
        {rows.length === 0 ? (
          <div className="table-card">
            <EmptyState icon="requests" body="You have not asked for any work yet." href="/farmer/book" action="Book a service" />
          </div>
        ) : (
          <div className="table-card">
            <table className="table table--requests">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Service</th>
                  <th scope="col">Location</th>
                  <th scope="col">Farm size</th>
                  <th scope="col">Preferred date</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><span className="table__ref"><ServiceIcon service={r.service} /><Link href={`/farmer/requests/${r.id}`}>{r.reference}</Link></span></td>
                    <td>{serviceLabel(r.service)}</td>
                    <td>{districtLabel(r.district)}</td>
                    <td>{r.acres} acres</td>
                    <td>{fmt(r.preferredDate)}</td>
                    <td><span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="table__go">
                      <Link href={`/farmer/requests/${r.id}`} tabIndex={-1} aria-hidden="true"><Icon name="chevron" size={24} /></Link>
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
