import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DISTRICTS, SERVICES } from "@/lib/business";
import { BookForm } from "@/components/requests/BookForm";
import { GuestShell } from "@/components/guest/GuestShell";
import { guestRequest } from "@/lib/guest";
import { asTyped } from "@/lib/land-size";

export const metadata: Metadata = { title: "Edit details" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const request = await guestRequest();
  if (!request) redirect("/request/find");
  // Once a provider has priced this, changing it would change what they priced.
  if (request.status !== "awaiting_quotes") redirect("/request/track");
  return (
    <GuestShell>
      <div className="modal modal--book guest__panel">
        <BookForm
          services={SERVICES}
          districts={DISTRICTS}
          service={request.service}
          requestId={request.id}
          guest
          cancelHref="/request/track"
          initial={{
            service: request.service, ...asTyped(request.acres), landAccess: request.landAccess,
            landCondition: request.landCondition, landClearance: request.landClearance, crop: request.crop, notes: request.notes,
            landType: request.landType, cropVariety: request.cropVariety, plantedOn: request.plantedOn, cropReadiness: request.cropReadiness,
            district: request.district, chiefdom: request.chiefdom, village: request.village, preferredDate: request.preferredDate,
            alternateDate: request.alternateDate ?? "",
            contactName: request.contactName, contactPhone: request.contactPhone.replace(/^\+232/, ""), contactEmail: request.contactEmail,
          }}
        />
      </div>
    </GuestShell>
  );
}
