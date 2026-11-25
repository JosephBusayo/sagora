import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { listForFarmer, respondersFor } from "@/lib/requests";
import { Shell } from "@/components/app/Shell";
import { pageOf } from "@/components/app/Pager";
import { FarmerRequestsList } from "@/components/requests/FarmerRequestsList";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "My requests" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ new?: string; page?: string; open?: string }> }) {
  const farmer = await requireFarmer();
  const sp = await searchParams;
  const justCreated = sp.new;
  const all = await listForFarmer(farmer.id);
  // A request used to open as a window over this list (?open=). It has its own page now; a link
  // to the old window, from a bookmark or an earlier email, goes there instead.
  if (sp.open && all.some((r) => r.id === sp.open)) redirect(`/farmer/requests/${sp.open}`);
  const { rows, page, pages } = pageOf(all, sp.page);
  const responses = await respondersFor(rows.map((r) => r.id));

  return (
    <Shell
      crumb={{ label: "My requests", icon: "requests" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <FarmerRequestsList rows={rows} page={page} pages={pages} justCreated={justCreated} responses={responses} />
    </Shell>
  );
}
