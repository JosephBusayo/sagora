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
import { ModalShell } from "@/components/app/ModalShell";
import { LAND_ACCESS, LAND_CONDITION, landLabel } from "@/lib/land";

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

const at = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="detail-row"><span className="detail-row__label">{label}</span><span className="detail-row__value">{children}</span></div>;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ new?: string; page?: string; open?: string }> }) {
  const farmer = await requireFarmer();
  const sp = await searchParams;
  const justCreated = sp.new;
  const all = await listForFarmer(farmer.id);
  const { rows, page, pages } = pageOf(all, sp.page);
  // The design's Request details window, opened from a row's arrow.
  const open = all.find((r) => r.id === sp.open);
  const back = page > 1 ? `/farmer/requests?page=${page}` : "/farmer/requests";

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
                    <td>{r.acres} acres</td>
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

      {open ? (
        <ModalShell closeHref={back} label="Request details" className="modal--request">
          <div className="modal__banner" aria-hidden="true">
            <span className="banner__ring banner__outer" />
            <span className="banner__ring banner__mid" />
            <span className="banner__ring banner__inner"><Icon name="payments" size={34} /></span>
          </div>
          <article className="asset asset--plain">
            <header className="modal__head"><h2>Request details</h2></header>
            <div className="detail-list">
              <Row label="Request ID">#{open.reference}</Row>
              <Row label="Requested on">{at(open.createdAt)}</Row>
              <Row label="Service">{serviceLabel(open.service)}</Row>
              <Row label="Land size">{open.acres} acres</Row>
              <Row label="Location">{open.village}, {districtLabel(open.district)}</Row>
              <Row label="Preferred start date">{fmt(open.preferredDate)}</Row>
              {open.landAccess ? <Row label="Land access">{landLabel(LAND_ACCESS, open.landAccess)}</Row> : null}
              {open.landCondition ? <Row label="Land condition">{landLabel(LAND_CONDITION, open.landCondition)}</Row> : null}
              <Row label="Status">
                {open.status === "quotes_sent" ? (
                  <Link href={`/farmer/requests/${open.id}`} className="pill pill--link">View quotes <Icon name="arrowOut" size={16} /></Link>
                ) : (
                  <span className={`pill pill--${open.status}`}>{STATUS_LABEL[open.status]}</span>
                )}
              </Row>
            </div>
            <div className="form-actions">
              <Link href={back} className="button button--soft">Close</Link>
              {open.status === "awaiting_quotes" ? (
                <Link href={`/farmer/requests/${open.id}/edit`} className="button">Edit request</Link>
              ) : (
                <Link href={`/farmer/requests/${open.id}`} className="button">Open request</Link>
              )}
            </div>
          </article>
        </ModalShell>
      ) : null}
    </Shell>
  );
}
