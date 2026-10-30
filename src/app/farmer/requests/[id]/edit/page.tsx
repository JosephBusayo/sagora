import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DISTRICTS, SERVICES } from "@/lib/business";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { BookForm } from "@/components/requests/BookForm";
import { getById } from "@/lib/requests";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Edit details" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const farmer = await requireFarmer();
  const { id } = await params;
  const request = await getById(id);
  if (!request || request.farmerId !== farmer.id) notFound();
  // Once a provider has priced this, changing it would change what they priced.
  if (request.status !== "awaiting_quotes") redirect(`/farmer/requests/${id}`);

  return (
    <Shell
      crumb={{ label: "My requests", icon: "requests" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead title="Requests" subtitle="All requests you’ve sent out to service providers" />
      <div className="modal-backdrop">
        <div className="modal modal--book" role="dialog" aria-modal="true" aria-label="Edit details">
          <BookForm
            services={SERVICES}
            districts={DISTRICTS}
            service={request.service}
            requestId={request.id}
            initial={{
              service: request.service, acres: String(request.acres), landAccess: request.landAccess,
              landCondition: request.landCondition, landClearance: request.landClearance, notes: request.notes,
              district: request.district, village: request.village, preferredDate: request.preferredDate,
              alternateDate: request.alternateDate ?? "",
            }}
          />
        </div>
      </div>
    </Shell>
  );
}
