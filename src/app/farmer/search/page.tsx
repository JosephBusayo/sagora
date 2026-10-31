import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, searchForFarmer, serviceLabel } from "@/lib/requests";
import { Shell, PageHead } from "@/components/app/Shell";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const farmer = await requireFarmer();
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const rows = q ? await searchForFarmer(farmer.id, q) : [];

  return (
    <Shell crumb={{ label: "Search", icon: "search" }} user={{ name: farmer.name }} audience="farmer" unread={await unreadCount(farmer)} search={q}>
      <PageHead title="Search" subtitle={q ? `Results for “${q}”` : "Search your requests"} />
      {rows.length === 0 ? <p className="empty">{q ? "Nothing matches that search." : "Type a reference, village or district."}</p> : (
        <ul className="search-results">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/farmer/requests/${r.id}`}>{r.reference}</Link>
              <span>{serviceLabel(r.service)} · {r.village}, {districtLabel(r.district)}</span>
              <span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
