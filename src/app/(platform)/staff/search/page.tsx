import { EmptyState } from "@/components/app/EmptyState";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/app/Shell";
import { StaffShell } from "@/components/staff/StaffShell";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, serviceLabel } from "@/lib/requests";
import { requireStaff } from "@/lib/session";
import { searchForStaff } from "@/lib/staff-search";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requireStaff();
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const { assisted, providers, payments } = await searchForStaff(q);
  const nothing = assisted.length + providers.length + payments.length === 0;

  return (
    <StaffShell staff={staff} crumb={{ label: "Search", icon: "search" }} search={q}>
      <PageHead title="Search" subtitle={q ? `Results for “${q}”` : "Search requests and providers..."} />
      {nothing ? <div className="table-card"><EmptyState icon="search" title={q ? "No results" : "Search Sagora"} body={q ? "Nothing matches that search." : "Type a reference, name or place."} /></div> : null}
      {assisted.length > 0 ? (
        <>
          <h2 className="quotes__heading">Assisted requests</h2>
          <ul className="search-results">
            {assisted.map((r) => (
              <li key={r.id}>
                <Link href={`/staff/requests/${r.id}`}>{r.reference}</Link>
                <span>{r.contactName} · {serviceLabel(r.service)} · {r.village}, {districtLabel(r.district)}</span>
                <span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {providers.length > 0 ? (
        <>
          <h2 className="quotes__heading">Providers waiting for review</h2>
          <ul className="search-results">
            {providers.map((b) => (
              <li key={b.id}>
                <Link href="/staff/providers">{b.name}</Link>
                <span>{b.sub}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {payments.length > 0 ? (
        <>
          <h2 className="quotes__heading">Payments</h2>
          <ul className="search-results">
            {payments.map((p) => (
              <li key={p.requestId}>
                <Link href="/staff/payments">{p.reference}</Link>
                <span>{p.businessName}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </StaffShell>
  );
}
