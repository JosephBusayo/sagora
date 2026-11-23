import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/app/Shell";
import { StaffShell } from "@/components/staff/StaffShell";
import { districtLabel } from "@/lib/business";
import { INSPECTION_LABEL, openInspections } from "@/lib/inspections";
import { serviceLabel } from "@/lib/requests";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Farm inspections" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });

const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86400_000);

/**
 * Every farm visit a provider is waiting on, with both sides' numbers on the one screen.
 *
 * Karim's reason for it (22 Nov 2026): people drop off the platform. A provider says they need to
 * see the land, and then nothing happens, because the farmer never comes back to answer. A
 * coordinator can ring both parties and move it along — but only if they can see who to ring, so
 * the farmer's and the provider's details sit side by side here rather than a request reference
 * on its own. The Follow-ups queue has an Inspections section too; this is the version with the
 * phone numbers in it.
 */
export default async function Page() {
  const staff = await requireStaff();
  const rows = await openInspections();
  const waiting = rows.filter((r) => r.status === "required");

  return (
    <StaffShell staff={staff} crumb={{ label: "Farm inspections", icon: "requests" }}>
      <PageHead
        title="Farm inspections"
        subtitle="Visits a provider needs before they can price the work. Ring both sides and agree a day."
      />
      {rows.length === 0 ? (
        <p className="field__helper">No provider is waiting to inspect a farm.</p>
      ) : (
        <>
          <p className="field__helper">
            {rows.length} open {rows.length === 1 ? "inspection" : "inspections"}
            {waiting.length > 0 ? `, ${waiting.length} with no day agreed yet` : ""}.
          </p>
          <ul className="search-results inspections-list">
            {rows.map((r) => {
              const days = daysSince(r.updatedAt);
              return (
                <li key={`${r.requestId}:${r.businessId}`}>
                  <span>
                    {/* Only a request with no account behind it has a staff page to open. */}
                    {r.assisted ? <Link href={`/staff/requests/${r.requestId}`}>{r.reference}</Link> : <strong>{r.reference}</strong>}
                    {" · "}{serviceLabel(r.service)} · {r.village}, {districtLabel(r.district)}
                  </span>
                  <span className={`pill pill--${r.status === "scheduled" ? "in_progress" : "awaiting_quotes"}`}>
                    {INSPECTION_LABEL[r.status]}
                    {r.status === "scheduled" && r.scheduledFor ? ` · ${fmt(r.scheduledFor)}` : ""}
                  </span>
                  <span>
                    <strong>Farmer:</strong> {r.farmerName} · {r.farmerPhone || "no number"}
                    {r.farmerEmail ? ` · ${r.farmerEmail}` : ""}
                    {r.hasAccount ? " · has an account" : r.assisted ? " · taken on a call" : " · sent from the website"}
                  </span>
                  <span>
                    <strong>Provider:</strong> {r.businessName} · {r.businessPhone || "no number"}
                    {r.businessEmail ? ` · ${r.businessEmail}` : ""}
                    {r.businessTown ? ` · ${r.businessTown}` : ""}
                  </span>
                  <span className="field__helper">
                    {r.proposedFor
                      ? `The farmer suggested ${fmt(r.proposedFor)}. Waiting for the provider to confirm.`
                      : r.status === "required"
                        ? "No day agreed. Ring the farmer and agree one, then tell the provider."
                        : "Booked. Check the farmer knows and someone will be there."}
                    {days >= 2 ? ` Nothing has moved for ${days} days.` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </StaffShell>
  );
}
