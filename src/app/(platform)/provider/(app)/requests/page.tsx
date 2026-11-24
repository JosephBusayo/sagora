import { inspectionFor } from "@/lib/inspections";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION, extraDetails, landLabel, missingDetails } from "@/lib/land";
import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { FilterPill } from "@/components/app/FilterPill";
import { DISTRICTS, SERVICES, districtLabel } from "@/lib/business";
import { DATE_WINDOWS, STATUS_LABEL, browse, serviceLabel, type RequestStatus } from "@/lib/requests";
import { describeOperations, operationsFor } from "@/lib/operations";
import { QUOTE_STATUS_LABEL, RESPONSE_HOURS, activityFor, currentQuote, endDateOf, expiresAt, holdsIntact, isExpired, type QuoteStatus } from "@/lib/quotes";
import { kindLabel, selectableAssets } from "@/lib/equipment";
import { listMembers } from "@/lib/team";
import { formatAmount } from "@/lib/money";
import { jobForRequest } from "@/lib/jobs";
import { RequestsTable, type RequestRow } from "@/components/requests/RequestsTable";
import { FilterAutoSubmit } from "@/components/requests/FilterAutoSubmit";
import { ZONE } from "@/lib/zone";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: ZONE,
  });
const fmtLong = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: ZONE,
  });

type Params = { service?: string; district?: string; window?: string; page?: string; open?: string };

/** The filters submit on change with JavaScript, and with a button without it. */
function Filters({ current }: { current: Params }) {
  const active = [current.service, current.district, current.window].filter(Boolean).length;
  return (
    <form className="filters" method="get">
      <FilterPill name="service" label="Service" value={current.service} icon="/icons/service.svg"
        options={[{ value: "", label: "All services" }, ...SERVICES.map((s) => ({ value: s.id, label: s.label }))]} />
      <FilterPill name="district" label="District" value={current.district} icon="/icons/pin.svg"
        options={[{ value: "", label: "All districts" }, ...DISTRICTS.map((d) => ({ value: d, label: d }))]} />
      <FilterPill name="window" label="Dates" value={current.window} icon="/icons/calendar.svg"
        options={DATE_WINDOWS.map((w) => ({ value: w.id, label: w.label }))} />
      {active > 0 ? <Link href="/provider/requests" className="filters__clear">Clear filters ({active})</Link> : null}
      <noscript><button type="submit" className="button button--inline">Apply</button></noscript>
      <FilterAutoSubmit />
    </form>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const { user, business } = await requireWorkspace();
  const sp = await searchParams;
  const page = Number(sp.page ?? "1") || 1;
  const { rows, pages } = await browse({ service: sp.service, district: sp.district, window: sp.window, reference: sp.open }, page, business);

  // Equipment is chosen with the price now, so the list is fetched once for the whole page rather
  // than per request. Only machines that can actually go out: retired and faulty ones are not
  // offered, the same rule scheduling has always used.
  const quotable = await selectableAssets(business.id);
  const assets = quotable.map((a) => ({
    id: a.id,
    name: a.name,
    // What tells two machines apart, in the order a provider would say it.
    detail: [kindLabel(a.kind), [a.brand, a.model].filter(Boolean).join(" "), a.horsepower ? `${a.horsepower} hp` : "", a.identifier]
      .filter(Boolean).join(" · "),
  }));
  const assetName = new Map(quotable.map((a) => [a.id, a.name] as const));

  // The handover wants an actual operator on the quote, not a role, so the team comes with it.
  // Only active people: an invitation nobody has accepted cannot be committed to work.
  const team = (await listMembers(business.id)).filter((m) => m.status === "active");
  const operators = team.map((m) => ({
    id: m.id,
    name: m.name,
    detail: [m.role, m.skills, m.awayFrom && m.awayTo ? `away ${m.awayFrom} to ${m.awayTo}` : ""]
      .filter(Boolean).join(" · "),
  }));
  const operatorName = new Map(team.map((m) => [m.id, m.name] as const));

  const items: RequestRow[] = await Promise.all(rows.map(async (r) => {
  // A package arrives as several stages in field order; a plain request as one. Read once here
  // because three fields below depend on it: the label, the stage planner and the quote it carries.
  const ops = await operationsFor(r.id);
  const mine = await currentQuote(r.id, business.id);
  return {
    id: r.id,
    reference: r.reference,
    service: r.service,
    // "Ploughing", or "Ploughing, then harrowing, then planting". A provider scanning the list has
    // to be able to see at a glance that a request is a package, because it is a different
    // commitment: every stage has to come from them.
    serviceLabel: ops.length > 1 ? describeOperations(ops) : serviceLabel(r.service),
    stages: ops.map((o) => {
      const was = mine?.plan.find((x) => x.operationId === o.id);
      return {
        id: o.id, service: o.service, serviceLabel: o.serviceLabel, sequence: o.sequence,
        startDate: was?.startDate,
        days: was?.daysToComplete,
        amountInput: was && was.amountMinor > 0 ? (was.amountMinor / 100).toFixed(2) : undefined,
        dailyRateInput: was && was.dailyRateMinor > 0 ? (was.dailyRateMinor / 100).toFixed(2) : undefined,
      };
    }),
    acres: r.acres,
    landAccess: landLabel(LAND_ACCESS, r.landAccess),
    landCondition: landLabel(LAND_CONDITION, r.landCondition),
    landClearance: landLabel(LAND_CLEARANCE, r.landClearance),
    crop: r.crop,
    extras: extraDetails(r),
    missing: missingDetails(r),
    direct: Boolean(r.directTo),
    preferredDate: fmt(r.preferredDate),
    alternateDate: r.alternateDate ? fmtLong(r.alternateDate) : null,
    district: districtLabel(r.district),
    chiefdom: r.chiefdom,
    village: r.village,
    notes: r.notes,
    submittedOn: fmt(r.createdAt.slice(0, 10)),
    inspection: await (async () => {
      const i = await inspectionFor(r.id, business.id);
      return i ? {
        status: i.status, scheduledFor: i.scheduledFor, findings: i.findings,
        openQuestions: i.openQuestions, proposedFor: i.proposedFor,
      } : null;
    })(),
    activity: (await activityFor(r.id, business.id, r.createdAt)).map((a) => ({ when: fmt(a.at.slice(0, 10)), text: a.text })),
    status: r.status,
    statusLabel: STATUS_LABEL[r.status as RequestStatus],
    myQuote: await (async () => {
      const q = mine;
      if (!q) return null;
      // Since the handover, sending a quote reserves everything it names, so a live quote cannot
      // clash with anybody — what can go wrong is that its reservation lapsed or was let go,
      // leaving a price with nothing behind it. Said here so the provider finds out from their own
      // screen rather than from a farmer who could not accept.
      const lost = q.status === "sent" && !isExpired(q) && !(await holdsIntact(q));
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
        days: q.daysToComplete,
        endDate: fmt(endDateOf(q)),
        assetIds: q.assetIds,
        assetNames: q.assetIds.map((id) => assetName.get(id) ?? "Equipment").join(", "),
        dailyRate: q.dailyRateMinor > 0 ? formatAmount(q.dailyRateMinor) : "",
        dailyRateInput: q.dailyRateMinor > 0 ? (q.dailyRateMinor / 100).toFixed(2) : "",
        operatorId: q.operatorId ?? "",
        operatorName: q.operatorId ? operatorName.get(q.operatorId) ?? "An operator" : "",
        expiresAt: q.status === "sent" ? expiresAt(q).toISOString() : "",
        // Shown to the provider in Sierra Leone time, which is UTC, so no conversion is needed.
        expiresAtLabel: q.status === "sent"
          ? expiresAt(q).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ZONE })
          : "",
        clash: lost
          ? "The equipment and operator this quote reserved are no longer held for those dates. Send a new quote to reserve them again."
          : null,
      };
    })(),
    // The job this became, so an accepted request can point at the work instead of at a quote
    // form it would only refuse.
    job: await (async () => {
      const j = await jobForRequest(r.id);
      return j ? { reference: r.reference, scheduled: Boolean(j.startDate) } : null;
    })(),
  };
  }));

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
      <RequestsTable rows={items} initialOpen={sp.open} filtered={Boolean(sp.service || sp.district || sp.window)}
        assets={assets} operators={operators} responseHours={RESPONSE_HOURS} />
      <nav className="pager" aria-label="Pages">
          {Array.from({ length: Math.max(1, pages) }, (_, i) => i + 1).map((p) =>
            p === Math.min(Math.max(1, page), Math.max(1, pages)) ? (
              <span key={p} className="is-current" aria-current="page">{p}</span>
            ) : (
              <Link key={p} href={href(p)}>{p}</Link>
            ),
          )}
      </nav>
    </Shell>
  );
}
