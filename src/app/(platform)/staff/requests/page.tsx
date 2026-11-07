import { PageHead } from "@/components/app/Shell";
import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { DISTRICTS, SERVICES, districtLabel } from "@/lib/business";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION } from "@/lib/land";
import { STATUS_LABEL, listAssisted, openRequestsForPhone, serviceLabel } from "@/lib/requests";
import { requireStaff } from "@/lib/session";
import { AssistedForm } from "@/components/staff/AssistedForm";
import { StaffShell } from "@/components/staff/StaffShell";

export const metadata: Metadata = { title: "Assisted requests" };
export const dynamic = "force-dynamic";

/** Requests taken over the phone for farmers with no account. No Figma frame exists for this. */
export default async function Page({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const staff = await requireStaff();
  const { phone = "" } = await searchParams;
  const rows = await listAssisted();
  const found = phone.trim() ? await openRequestsForPhone(phone) : null;
  return (
    <StaffShell staff={staff} crumb={{ label: "Assisted requests", icon: "requests" }}>
        <PageHead title="Assisted requests" subtitle="For farmers who call instead of using the app." />
        <form className="form-soft caller-search" method="get">
          <div className="field">
            <label className="field__label" htmlFor="caller-phone">Has this caller asked before? Search their number</label>
            <div className="field__box"><input id="caller-phone" name="phone" type="tel" className="field__input" defaultValue={phone} /></div>
          </div>
          <button type="submit" className="button button--inline">Search</button>
        </form>
        {found ? (
          found.length ? (
            <ul className="search-results" aria-label="Open requests from this number">
              {found.map((r) => (
                <li key={r.id}>
                  {r.farmerId ? <span>{r.reference}</span> : <Link href={`/staff/requests/${r.id}`}>{r.reference}</Link>}
                  <span>{r.contactName} · {serviceLabel(r.service)} · {r.village}, {districtLabel(r.district)}{r.farmerId ? " · has an account" : r.assistedBy ? "" : " · sent from the website"}</span>
                  <span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span>
                </li>
              ))}
            </ul>
          ) : <p className="field__helper">No open request from this number.</p>
        ) : null}
        {rows.length > 0 ? (
          <ul className="search-results">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/staff/requests/${r.id}`}>{r.reference}</Link>
                <span>{r.contactName} · {serviceLabel(r.service)} · {r.village}, {districtLabel(r.district)}</span>
                <span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <section className="staff__item">
          <h2>New request</h2>
          <AssistedForm services={SERVICES} districts={DISTRICTS} access={LAND_ACCESS} condition={LAND_CONDITION} clearance={LAND_CLEARANCE} submissionKey={randomUUID()} />
        </section>
    </StaffShell>
  );
}
