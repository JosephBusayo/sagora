import type { Metadata } from "next";
import { PageHead } from "@/components/app/Shell";
import { PendingButton } from "@/components/app/PendingButton";
import { StaffShell } from "@/components/staff/StaffShell";
import { DISTRICTS, SERVICES, districtLabel } from "@/lib/business";
import { listRequests, requestBlockers } from "@/lib/admin";
import { STATUS_LABEL, serviceLabel, type RequestStatus } from "@/lib/requests";
import { requireAdmin } from "@/lib/session";
import { OUTCOME_LABEL, routingFor, summarise, unroutedRequests } from "@/lib/routing";
import { landSize } from "@/lib/land-size";
import { cancelRequestAction, deleteRequestAction, updateRequestAction } from "../actions";

export const metadata: Metadata = { title: "All requests" };
export const dynamic = "force-dynamic";

/**
 * Every request on Sagora, editable and deletable by an administrator (Karim, 23 Nov 2026).
 *
 * requireAdmin() is the gate: ordinary staff never reach this screen, and the actions it posts to
 * check again on the server, so knowing the URL is not enough.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdmin();
  const { q = "" } = await searchParams;
  const rows = await listRequests(q.trim());
  // Worked out once per row so the screen can say why a delete will be refused before it is
  // tried, rather than after. An admin should not have to click to find out.
  const blockers = new Map(await Promise.all(rows.map(async (r) => [r.id, await requestBlockers(r.id)] as const)));
  // A01: why each provider did or did not hear about this request. Recorded at the moment the
  // decision was made, so it still explains a request from last month whose coverage has changed
  // since — which is the whole reason a log beats reconstructing it from today's coverage.
  const routing = new Map(await Promise.all(rows.map(async (r) => [r.id, await routingFor(r.id)] as const)));
  // The question underneath all of it: is Sagora quietly dropping work nobody covers?
  const unrouted = await unroutedRequests(10);

  return (
    <StaffShell staff={admin} crumb={{ label: "All requests", icon: "requests" }}>
      <PageHead title="All requests" subtitle="Every request on Sagora. Only administrators can change or remove one." />

      <form className="form-soft caller-search" method="get">
        <div className="field">
          <label className="field__label" htmlFor="q">Search by reference, name, phone or village</label>
          <div className="field__box"><input id="q" name="q" className="field__input" defaultValue={q} /></div>
        </div>
        <button type="submit" className="button button--inline">Search</button>
      </form>

      <p className="field__helper">{rows.length === 0 ? "No requests match." : `${rows.length} request${rows.length === 1 ? "" : "s"}.`}</p>

      {/* A coverage gap, not a bug: these requests were routed and no approved provider was
          eligible for any of them. Something a person can act on — recruit, or ask a provider to
          extend — which is why it is at the top rather than buried in a per-request panel. */}
      {unrouted.length > 0 ? (
        <div className="notice notice--warn" role="status">
          <strong>{unrouted.length === 1 ? "One open request" : `${unrouted.length} open requests`} no provider can quote.</strong>
          <ul className="activity__list">
            {unrouted.map((u) => (
              <li key={u.requestId}>
                {u.reference} — {serviceLabel(u.service)} in {districtLabel(u.district)}
              </li>
            ))}
          </ul>
          Nobody approved covers that service in that district. The farmers are waiting on a quote
          that cannot come.
        </div>
      ) : null}

      <ul className="queue__list">
        {rows.map((r) => {
          const blocked = blockers.get(r.id) ?? [];
          return (
            <li key={r.id} className="queue__item">
              <div className="queue__head">
                <strong>{r.reference}</strong>
                <span>{r.contactName || "No name"} · {r.contactPhone || "no number"}</span>
                <span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status as RequestStatus] ?? r.status}</span>
              </div>
              <p className="field__helper">
                {r.service} · {landSize(r.acres)} · {r.village}{r.chiefdom ? `, ${r.chiefdom}` : ""}, {districtLabel(r.district)}
                {" · "}wants {r.preferredDate}
                {r.farmerId ? " · has an account" : " · no account"}
              </p>

              {/* "Log every routing decision — eligible, notified or excluded, and why — and make it
                  visible to an administrator." This is the visible part. */}
              <details className="routing">
                <summary>Who heard about it — {summarise(routing.get(r.id) ?? [])}</summary>
                {(routing.get(r.id) ?? []).length === 0 ? (
                  <p className="field__helper">
                    No routing decision was recorded. Requests made before this log existed have none;
                    there is nothing wrong with the request itself.
                  </p>
                ) : (
                  <ul className="routing__list">
                    {(routing.get(r.id) ?? []).map((d) => (
                      <li key={d.businessId}>
                        <span className={`pill pill--${d.outcome === "notified" ? "completed" : d.outcome === "eligible" ? "in_progress" : "cancelled"}`}>
                          {OUTCOME_LABEL[d.outcome]}
                        </span>
                        <span className="routing__who">
                          <strong>{d.businessName}</strong>
                          {d.reason ? <span className="field__helper">{d.reason}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>

              <details>
                <summary>Edit</summary>
                <form action={updateRequestAction} className="form-soft queue__form">
                  <input type="hidden" name="id" value={r.id} />
                  <div className="field">
                    <label className="field__label" htmlFor={`s-${r.id}`}>Service</label>
                    <div className="field__box">
                      <select id={`s-${r.id}`} name="service" className="field__input" defaultValue={r.service}>
                        {SERVICES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`a-${r.id}`}>Land size (acres)</label>
                    <div className="field__box">
                      <input id={`a-${r.id}`} name="acres" type="number" min={0.1} step={0.1} className="field__input" defaultValue={r.acres} />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`d-${r.id}`}>District</label>
                    <div className="field__box">
                      <select id={`d-${r.id}`} name="district" className="field__input" defaultValue={r.district}>
                        {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`c-${r.id}`}>Chiefdom</label>
                    <div className="field__box"><input id={`c-${r.id}`} name="chiefdom" className="field__input" defaultValue={r.chiefdom} /></div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`v-${r.id}`}>Village</label>
                    <div className="field__box"><input id={`v-${r.id}`} name="village" className="field__input" defaultValue={r.village} /></div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`p-${r.id}`}>Preferred date</label>
                    <div className="field__box">
                      <input id={`p-${r.id}`} name="preferredDate" type="date" className="field__input" defaultValue={r.preferredDate} />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`n-${r.id}`}>Farmer&rsquo;s name</label>
                    <div className="field__box"><input id={`n-${r.id}`} name="contactName" className="field__input" defaultValue={r.contactName} /></div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`ph-${r.id}`}>Farmer&rsquo;s phone</label>
                    <div className="field__box"><input id={`ph-${r.id}`} name="contactPhone" className="field__input" defaultValue={r.contactPhone} /></div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`no-${r.id}`}>Additional information</label>
                    <div className="field__box"><input id={`no-${r.id}`} name="notes" className="field__input" maxLength={1000} defaultValue={r.notes} /></div>
                  </div>
                  {/* Email is absent on purpose: it is the farmer's login. */}
                  <p className="field__helper">
                    The email address is not editable here — it is how the farmer signs in. They change it themselves from their
                    account settings, which verifies the new address first.
                  </p>
                  <PendingButton className="button button--inline">Save changes</PendingButton>
                </form>
              </details>

              <div className="request-card__actions">
                {r.status !== "cancelled" ? (
                  <form action={cancelRequestAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <PendingButton className="button button--soft button--inline"
                      confirm="Cancel this request?" confirmBody="Providers stop seeing it. The record and its history are kept, and this can be undone by the farmer re-requesting."
                      confirmAction="Cancel request">Cancel</PendingButton>
                  </form>
                ) : null}
                <form action={deleteRequestAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <PendingButton className="button button--inline" disabled={blocked.length > 0}
                    confirm={`Delete ${r.reference} for good?`}
                    confirmBody="The request is removed from the database entirely. This cannot be undone."
                    confirmAction="Delete for good">Delete</PendingButton>
                </form>
              </div>
              {blocked.length > 0 ? (
                <p className="field__helper">
                  Cannot be deleted: it has {blocked.map((b) => `${b.count} ${b.what}`).join(", ")}. Cancel it instead.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </StaffShell>
  );
}
