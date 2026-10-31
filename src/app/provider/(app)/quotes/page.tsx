import { PendingButton } from "@/components/app/PendingButton";
import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { Pager, pageOf } from "@/components/app/Pager";
import { Icon } from "@/components/app/Icon";
import { districtLabel } from "@/lib/business";
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

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { user, business } = await requireWorkspace();
  const { rows: quotes, page, pages } = pageOf(await listForBusiness(business.id), (await searchParams).page);

  return (
    <Shell crumb={{ label: "My quotes", icon: "quotes" }} user={{ name: user.name }}>
      <PageHead title="My quotes" subtitle="View and manage the quotes you’ve sent to farmers" />
      {quotes.length === 0 ? (
        <div className="table-card"><p className="empty">You have not sent any quotes yet. Open a request to send one.</p></div>
      ) : (
        <div className="table-card">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Service</th>
                <th scope="col">Location</th>
                <th scope="col">Price</th>
                <th scope="col">Holds until</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const expired = isExpired(q);
                return (
                  <tr key={q.id}>
                    <td>
                      <span className="table__person">
                        <span className="request-icon" aria-hidden="true">
                          <Icon name={q.service === "harvesting" ? "quotes" : "equipment"} size={22} />
                        </span>
                        <span>{q.reference}{q.version > 1 ? <span className="field__helper"> v{q.version}</span> : null}</span>
                      </span>
                    </td>
                    <td>{serviceLabel(q.service)}</td>
                    <td>{districtLabel(q.district)}</td>
                    <td>{formatAmount(q.amountMinor)}</td>
                    <td>{fmt(q.validUntil)}</td>
                    <td>
                      <span className={`pill pill--${expired ? "cancelled" : PILL[q.status]}`}>
                        {expired ? "Expired" : QUOTE_STATUS_LABEL[q.status]}
                      </span>
                    </td>
                    <td className="table__actions">
                      {q.status === "sent" ? (
                        <form action={withdrawQuoteAction}>
                          <input type="hidden" name="requestId" value={q.requestId} />
                          <PendingButton confirm="Withdraw this quote?" className="resend__button">Withdraw</PendingButton>
                        </form>
                      ) : null}
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
