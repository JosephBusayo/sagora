import { Icon } from "@/components/app/Icon";
import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, listForFarmer, serviceLabel } from "@/lib/requests";
import { Shell } from "@/components/app/Shell";
import { placeLine } from "@/lib/chiefdoms";
import { pageOf } from "@/components/app/Pager";
import { FarmerRequestsList } from "@/components/requests/FarmerRequestsList";
import { unreadCount } from "@/lib/notifications";
import { ModalShell } from "@/components/app/ModalShell";
import { LAND_ACCESS, LAND_CONDITION, landLabel } from "@/lib/land";

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
      <FarmerRequestsList rows={rows} page={page} pages={pages} justCreated={justCreated} />

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
              <Row label="Location">{placeLine(open.village, open.chiefdom, districtLabel(open.district))}</Row>
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
