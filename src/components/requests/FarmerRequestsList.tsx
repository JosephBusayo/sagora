import { Icon, ServiceIcon } from "@/components/app/Icon";
import { EmptyState } from "@/components/app/EmptyState";
import Link from "next/link";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, serviceLabel, type ServiceRequest } from "@/lib/requests";
import { PageHead } from "@/components/app/Shell";
import { Pager } from "@/components/app/Pager";
import { landSize } from "@/lib/land-size";

const BOOK = [
  { service: "ploughing", title: "Book ploughing service", body: "Prepare your land for planting" },
  { service: "harvesting", title: "Book harvesting service", body: "Harvest your crops efficiently" },
  // Not in the design yet: planting was added after it was drawn.
  { service: "planting", title: "Book planting service", body: "Get your crops in the ground on time" },
];

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });

/**
 * The My requests screen's content. On its own because a request opens as a window over it, as
 * the design draws every detail window: the list stays behind, blurred.
 */
export function FarmerRequestsList({ rows, page, pages, justCreated }: {
  rows: ServiceRequest[]; page: number; pages: number; justCreated?: string;
}) {
  return (
    <>
      <PageHead title="Requests" subtitle="All requests you’ve sent out to service providers" />
      <>
        <div className="home-cards home-cards--services home-cards--tight">
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
            <EmptyState icon="requests" title="No requests yet" body="You have not asked for any work yet." href="/farmer/book" action="Book a service" />
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
                    <td>{landSize(r.acres)}</td>
                    <td>{fmt(r.preferredDate)}</td>
                    <td><span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="table__go">
                      <Link href={`/farmer/requests?${page > 1 ? `page=${page}&` : ""}open=${r.id}`} aria-label="Request details"><Icon name="chevron" size={24} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pages={pages} path="/farmer/requests" />
      </>
    </>
  );
}
