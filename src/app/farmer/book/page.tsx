import type { Metadata } from "next";
import { DISTRICTS, SERVICES } from "@/lib/business";
import { requireFarmer } from "@/lib/session";
import { Shell } from "@/components/app/Shell";
import { FarmerHome } from "@/components/app/FarmerHome";
import { BookForm } from "@/components/requests/BookForm";
import { getById, listForFarmer } from "@/lib/requests";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Book a service" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ service?: string; again?: string }> }) {
  const farmer = await requireFarmer();
  const { service: asked = "", again } = await searchParams;
  const service = SERVICES.some((s) => s.id === asked) ? asked : "";

  // "Book again" starts from the finished request. Dates are left out: they have passed.
  const past = again ? await getById(again) : null;
  const previous = past && past.farmerId === farmer.id ? {
    service: past.service, acres: String(past.acres), landAccess: past.landAccess, landCondition: past.landCondition,
    landClearance: past.landClearance, notes: past.notes, district: past.district, village: past.village,
  } : undefined;

  return (
    <Shell
      crumb={{ label: "Book a service", icon: "plus" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <FarmerHome name={farmer.name} requests={(await listForFarmer(farmer.id)).slice(0, 3)} />
      {/* Rendered by the server over Home, so it opens with JavaScript off. */}
      <div className="modal-backdrop">
        <div className="modal modal--book" role="dialog" aria-modal="true" aria-label="Book a service">
          <BookForm services={SERVICES} districts={DISTRICTS} service={previous?.service ?? service} initial={previous} />
        </div>
      </div>
    </Shell>
  );
}
