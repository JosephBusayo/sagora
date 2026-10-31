import Link from "next/link";
import { FilterPill } from "@/components/app/FilterPill";
import { FilterAutoSubmit } from "@/components/requests/FilterAutoSubmit";
import { EmptyState } from "@/components/app/EmptyState";
import { PendingButton } from "@/components/app/PendingButton";
import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { Pager, pageOf } from "@/components/app/Pager";
import { Icon, ServiceIcon } from "@/components/app/Icon";
import { SERVICES, districtLabel } from "@/lib/business";
import { formatAmount } from "@/lib/money";
import { serviceLabel } from "@/lib/requests";
import { QUOTE_STATUS_LABEL, isExpired, listForBusiness } from "@/lib/quotes";
import { withdrawQuoteAction } from "../requests/quote-actions";

export const metadata: Metadata = { title: "My quotes" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** One colour per state, reusing the request pills. */
const PILL: Record<string, string> = {
  sent: "awaiting_quotes",
  accepted: "quotes_sent",
  not_selected: "cancelled",
  withdrawn: "cancelled",
  superseded: "awaiting_quotes",
};

type Filters = { page?: string; service?: string; district?: string; sent?: string };
const WINDOWS = [{ value: "", label: "All dates" }, { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }];

export default async function Page({ searchParams }: { searchParams: Promise<Filters> }) {
  const { user, business } = await requireWorkspace();
  const sp = await searchParams;
  const all = await listForBusiness(business.id);
  const districts = [...new Set(all.map((q) => q.district))].sort();
  const since = sp.sent ? new Date(Date.now() - Number(sp.sent) * 86400000).toISOString() : "";
  const { rows: quotes, page, pages } = pageOf(all.filter((q) =>
    (!sp.service || q.service === sp.service) && (!sp.district || q.district === sp.district) && q.createdAt >= since,
  ), sp.page);

  return (
    <Shell crumb={{ label: "My quotes", icon: "quotes" }} user={{ name: user.name }}>
      <PageHead title="My quotes" subtitle="View and manage the quotes you’ve sent to farmers" action={
        <form className="filters" method="get">
          <FilterPill name="service" label="Service" value={sp.service} icon="/icons/service.svg"
            options={[{ value: "", label: "All services" }, ...SERVICES.map((s) => ({ value: s.id, label: s.label }))]} />
          <FilterPill name="district" label="District" value={sp.district} icon="/icons/pin.svg"
            options={[{ value: "", label: "All districts" }, ...districts.map((d) => ({ value: d, label: districtLabel(d) }))]} />
          <FilterPill name="sent" label="Dates" value={sp.sent} icon="/icons/calendar.svg" options={WINDOWS} />
          <noscript><button type="submit" className="button button--inline">Apply</button></noscript>
          <FilterAutoSubmit />
        </form>
      } />
      {quotes.length === 0 ? (
        <div className="table-card"><EmptyState icon="quotes" body="You have not sent any quotes yet. Open a request to send one." href="/provider/requests" action="See requests" /></div>
      ) : (
        <div className="table-card">
          <table className="table table--requests">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Service</th>
                <th scope="col">Location</th>
                <th scope="col">Quoted amount</th>
                <th scope="col">Date sent</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const expired = isExpired(q);
                return (
                  <tr key={q.id}>
                    <td>
                      <span className="table__person">
                        <ServiceIcon service={q.service} />
                        <span>{q.reference}{q.version > 1 ? <span className="field__helper"> v{q.version}</span> : null}</span>
                      </span>
                    </td>
                    <td>{serviceLabel(q.service)}</td>
                    <td>{districtLabel(q.district)}</td>
                    <td>{formatAmount(q.amountMinor)}</td>
                    <td title={`Holds until ${fmt(q.validUntil)}`}>{fmt(q.createdAt.slice(0, 10))}</td>
                    <td>
                      <span className={`pill pill--${expired ? "cancelled" : PILL[q.status]}`}>
                        {expired ? "Expired" : QUOTE_STATUS_LABEL[q.status]}
                      </span>
                    </td>
                    <td className="table__go">
                      {q.status === "sent" ? (
                        <form action={withdrawQuoteAction}>
                          <input type="hidden" name="requestId" value={q.requestId} />
                          <PendingButton confirm="Withdraw this quote?" confirmBody="The farmer will no longer be able to accept it." confirmAction="Withdraw quote" className="resend__button">Withdraw</PendingButton>
                        </form>
                      ) : null}
                      <Link href={`/provider/requests?open=${q.reference}`} aria-label={`Open quote ${q.reference}`}><Icon name="chevron" size={24} /></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} path="/provider/quotes" />
    </Shell>
  );
}
