import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION, landLabel } from "@/lib/land";
import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { Icon } from "@/components/app/Icon";
import { DISTRICTS, SERVICES, districtLabel } from "@/lib/business";
import { DATE_WINDOWS, STATUS_LABEL, browse, serviceLabel, type RequestStatus } from "@/lib/requests";
import { QUOTE_STATUS_LABEL, activityFor, currentQuote, isExpired, type QuoteStatus } from "@/lib/quotes";
import { formatAmount } from "@/lib/money";
import { RequestsTable, type RequestRow } from "@/components/requests/RequestsTable";
import { FilterAutoSubmit } from "@/components/requests/FilterAutoSubmit";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
const fmtLong = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

type Params = { service?: string; district?: string; window?: string; page?: string };

/** The filters submit on change with JavaScript, and with a button without it. */
function Filters({ current }: { current: Params }) {
  return (
    <form className="filters" method="get">
      <label className="filter">
        <Icon name="dots" size={16} />
        <span className="sr-only">Service</span>
        <select name="service" defaultValue={current.service ?? ""}>
          <option value="">All services</option>
          {SERVICES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label className="filter">
        <Icon name="pin" size={16} />
        <span className="sr-only">District</span>
        <select name="district" defaultValue={current.district ?? ""}>
          <option value="">All districts</option>
          {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <label className="filter">
        <Icon name="requests" size={16} />
        <span className="sr-only">Dates</span>
        <select name="window" defaultValue={current.window ?? ""}>
          {DATE_WINDOWS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </label>
      <noscript><button type="submit" className="button button--inline">Apply</button></noscript>
      <FilterAutoSubmit />
    </form>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const { user, business } = await requireWorkspace();
  const sp = await searchParams;
  const page = Number(sp.page ?? "1") || 1;
  const { rows, pages } = await browse({ service: sp.service, district: sp.district, window: sp.window }, page);

  const items: RequestRow[] = await Promise.all(rows.map(async (r) => ({
    id: r.id,
    reference: r.reference,
    service: r.service,
    serviceLabel: serviceLabel(r.service),
    acres: r.acres,
    landAccess: landLabel(LAND_ACCESS, r.landAccess),
    landCondition: landLabel(LAND_CONDITION, r.landCondition),
    landClearance: landLabel(LAND_CLEARANCE, r.landClearance),
    preferredDate: fmt(r.preferredDate),
    alternateDate: r.alternateDate ? fmtLong(r.alternateDate) : null,
    district: districtLabel(r.district),
    village: r.village,
    notes: r.notes,
    submittedOn: fmt(r.createdAt.slice(0, 10)),
    activity: (await activityFor(r.id, business.id, r.createdAt)).map((a) => ({ when: fmt(a.at.slice(0, 10)), text: a.text })),
    status: r.status,
    statusLabel: STATUS_LABEL[r.status as RequestStatus],
    myQuote: await (async () => {
      const q = await currentQuote(r.id, business.id);
      if (!q) return null;
      return {
        version: q.version,
        status: q.status,
        statusLabel: QUOTE_STATUS_LABEL[q.status as QuoteStatus],
        amount: formatAmount(q.amountMinor),
        amountInput: (q.amountMinor / 100).toFixed(2),
        includes: q.includes,
        startDate: q.startDate,
        validUntil: q.validUntil,
        note: q.note,
        expired: isExpired(q),
      };
    })(),
  })));

  const href = (p: number) => {
    const q = new URLSearchParams();
    if (sp.service) q.set("service", sp.service);
    if (sp.district) q.set("district", sp.district);
    if (sp.window) q.set("window", sp.window);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/provider/requests?${s}` : "/provider/requests";
  };

  return (
    <Shell crumb={{ label: "Requests", icon: "requests" }} user={{ name: user.name }}>
      <PageHead
        title="Requests"
        subtitle="Browse new requests from farmers and send a quote for the ones you can service"
        action={<Filters current={sp} />}
      />
      <RequestsTable rows={items} />
      {pages > 1 ? (
        <nav className="pager" aria-label="Pages">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) =>
            p === Math.min(Math.max(1, page), pages) ? (
              <span key={p} className="is-current" aria-current="page">{p}</span>
            ) : (
              <Link key={p} href={href(p)}>{p}</Link>
            ),
          )}
        </nav>
      ) : null}
    </Shell>
  );
}
