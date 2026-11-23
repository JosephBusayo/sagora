import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/app/Shell";
import { PendingButton } from "@/components/app/PendingButton";
import { StaffShell } from "@/components/staff/StaffShell";
import { listFarmers } from "@/lib/admin";
import { requireAdmin } from "@/lib/session";
import { deleteFarmerAction, updateFarmerAction } from "../actions";

export const metadata: Metadata = { title: "All farmers" };
export const dynamic = "force-dynamic";

/**
 * Every farmer account, editable and removable by an administrator (Karim, 23 Nov 2026).
 *
 * Only farmers. Staff and admin accounts are managed on the Staff screen, where removing one has
 * its own rules, and a provider's login belongs with their business.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdmin();
  const { q = "" } = await searchParams;
  const rows = await listFarmers(q.trim());

  return (
    <StaffShell staff={admin} crumb={{ label: "All farmers", icon: "account" }}>
      <PageHead title="All farmers" subtitle="Every farmer account. Only administrators can change or remove one." />

      <form className="form-soft caller-search" method="get">
        <div className="field">
          <label className="field__label" htmlFor="q">Search by name, email or phone</label>
          <div className="field__box"><input id="q" name="q" className="field__input" defaultValue={q} /></div>
        </div>
        <button type="submit" className="button button--inline">Search</button>
      </form>

      <p className="field__helper">{rows.length === 0 ? "No farmers match." : `${rows.length} farmer${rows.length === 1 ? "" : "s"}.`}</p>

      <ul className="queue__list">
        {rows.map((f) => (
          <li key={f.id} className="queue__item">
            <div className="queue__head">
              <strong>{f.name || "No name"}</strong>
              <span>{f.phone || "no number"} · {f.email}</span>
              {!f.emailVerified ? <span className="pill pill--cancelled">Email not verified</span> : null}
            </div>
            <p className="field__helper">
              {f.requests === 0 ? "No requests" : `${f.requests} request${f.requests === 1 ? "" : "s"}`}
            </p>

            <details>
              <summary>Edit</summary>
              <form action={updateFarmerAction} className="form-soft queue__form">
                <input type="hidden" name="id" value={f.id} />
                <div className="field">
                  <label className="field__label" htmlFor={`n-${f.id}`}>Name</label>
                  <div className="field__box"><input id={`n-${f.id}`} name="name" className="field__input" defaultValue={f.name} /></div>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`p-${f.id}`}>Phone</label>
                  <div className="field__box"><input id={`p-${f.id}`} name="phone" className="field__input" defaultValue={f.phone} /></div>
                </div>
                <p className="field__helper">
                  The email address is not editable here — it is how this farmer signs in, so changing it would lock them out
                  with no warning. They change it themselves from their account settings, which verifies the new address first.
                </p>
                <PendingButton className="button button--inline">Save changes</PendingButton>
              </form>
            </details>

            <div className="request-card__actions">
              <form action={deleteFarmerAction}>
                <input type="hidden" name="id" value={f.id} />
                <PendingButton className="button button--inline" disabled={f.requests > 0}
                  confirm={`Delete ${f.name || f.email} for good?`}
                  confirmBody="The account, its logins and sessions are removed entirely. This cannot be undone."
                  confirmAction="Delete for good">Delete</PendingButton>
              </form>
            </div>
            {f.requests > 0 ? (
              <p className="field__helper">
                Cannot be deleted: {f.requests} request{f.requests === 1 ? "" : "s"} belong to this account. Remove or cancel
                them on <Link href="/staff/admin/requests">All requests</Link> first, or leave the account alone.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </StaffShell>
  );
}
