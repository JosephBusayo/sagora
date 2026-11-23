import type { Metadata } from "next";
import { PageHead } from "@/components/app/Shell";
import { PendingButton } from "@/components/app/PendingButton";
import { StaffShell } from "@/components/staff/StaffShell";
import { DISTRICTS } from "@/lib/business";
import { listProviders, providerBlockers } from "@/lib/admin";
import { requireAdmin } from "@/lib/session";
import { deleteProviderAction, suspendProviderAction, updateProviderAction } from "../actions";

export const metadata: Metadata = { title: "All providers" };
export const dynamic = "force-dynamic";

/** Every provider business, editable and removable by an administrator (Karim, 23 Nov 2026). */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdmin();
  const { q = "" } = await searchParams;
  const rows = await listProviders(q.trim());
  const blockers = new Map(await Promise.all(rows.map(async (r) => [r.id, await providerBlockers(r.id)] as const)));

  return (
    <StaffShell staff={admin} crumb={{ label: "All providers", icon: "store" }}>
      <PageHead title="All providers" subtitle="Every provider business. Only administrators can change or remove one." />

      <form className="form-soft caller-search" method="get">
        <div className="field">
          <label className="field__label" htmlFor="q">Search by business name, email or phone</label>
          <div className="field__box"><input id="q" name="q" className="field__input" defaultValue={q} /></div>
        </div>
        <button type="submit" className="button button--inline">Search</button>
      </form>

      <p className="field__helper">{rows.length === 0 ? "No providers match." : `${rows.length} business${rows.length === 1 ? "" : "es"}.`}</p>

      <ul className="queue__list">
        {rows.map((b) => {
          const blocked = blockers.get(b.id) ?? [];
          return (
            <li key={b.id} className="queue__item">
              <div className="queue__head">
                <strong>{b.name || "Unnamed business"}</strong>
                <span>{b.phone || "no number"} · {b.email || "no email"}</span>
                <span className={`pill pill--${b.status === "approved" ? "completed" : b.status === "rejected" ? "cancelled" : "awaiting_quotes"}`}>{b.status}</span>
              </div>
              <p className="field__helper">{b.town ? `${b.town}, ` : ""}{b.district || "no district"}</p>

              <details>
                <summary>Edit</summary>
                <form action={updateProviderAction} className="form-soft queue__form">
                  <input type="hidden" name="id" value={b.id} />
                  <div className="field">
                    <label className="field__label" htmlFor={`n-${b.id}`}>Business name</label>
                    <div className="field__box"><input id={`n-${b.id}`} name="name" className="field__input" defaultValue={b.name} /></div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`p-${b.id}`}>Phone</label>
                    <div className="field__box"><input id={`p-${b.id}`} name="phone" className="field__input" defaultValue={b.phone} /></div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`d-${b.id}`}>District</label>
                    <div className="field__box">
                      <select id={`d-${b.id}`} name="district" className="field__input" defaultValue={b.district}>
                        <option value="">Not set</option>
                        {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`t-${b.id}`}>Town</label>
                    <div className="field__box"><input id={`t-${b.id}`} name="town" className="field__input" defaultValue={b.town} /></div>
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={`de-${b.id}`}>About the business</label>
                    <div className="field__box"><input id={`de-${b.id}`} name="description" className="field__input" maxLength={1000} defaultValue={b.description} /></div>
                  </div>
                  <p className="field__helper">
                    The email address is not editable here — it is how the provider signs in, and changing it would lock them out
                    of their own account. Which districts and services they cover is on Provider review.
                  </p>
                  <PendingButton className="button button--inline">Save changes</PendingButton>
                </form>
              </details>

              <div className="request-card__actions">
                {b.status !== "rejected" ? (
                  <form action={suspendProviderAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <PendingButton className="button button--soft button--inline"
                      confirm={`Suspend ${b.name}?`}
                      confirmBody="They stop being shown new requests and cannot quote. Their equipment, jobs and history are kept, and Provider review can approve them again."
                      confirmAction="Suspend">Suspend</PendingButton>
                  </form>
                ) : null}
                <form action={deleteProviderAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <PendingButton className="button button--inline" disabled={blocked.length > 0}
                    confirm={`Delete ${b.name} for good?`}
                    confirmBody="The business, its equipment, coverage, documents and team rows are removed entirely. The owner's login is kept. This cannot be undone."
                    confirmAction="Delete for good">Delete</PendingButton>
                </form>
              </div>
              {blocked.length > 0 ? (
                <p className="field__helper">
                  Cannot be deleted: {blocked.map((x) => `${x.count} ${x.what}`).join(", ")}. Suspend them instead.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </StaffShell>
  );
}
