import { PageHead } from "@/components/app/Shell";
import type { Metadata } from "next";
import Link from "next/link";
import { DISTRICTS, SERVICES, districtLabel } from "@/lib/business";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION } from "@/lib/land";
import { STATUS_LABEL, listAssisted, serviceLabel } from "@/lib/requests";
import { requireStaff } from "@/lib/session";
import { AssistedForm } from "@/components/staff/AssistedForm";
import { StaffShell } from "@/components/staff/StaffShell";

export const metadata: Metadata = { title: "Assisted requests" };
export const dynamic = "force-dynamic";

/** Requests taken over the phone for farmers with no account. No Figma frame exists for this. */
export default async function Page() {
  const staff = await requireStaff();
  const rows = await listAssisted();
  return (
    <StaffShell staff={staff} crumb={{ label: "Assisted requests", icon: "requests" }}>
        <PageHead title="Assisted requests" subtitle="For farmers who call instead of using the app." />
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
          <AssistedForm services={SERVICES} districts={DISTRICTS} access={LAND_ACCESS} condition={LAND_CONDITION} clearance={LAND_CLEARANCE} />
        </section>
    </StaffShell>
  );
}
