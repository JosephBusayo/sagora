import { RequestDetail } from "@/components/requests/RequestDetail";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { getById } from "@/lib/requests";
import { Shell } from "@/components/app/Shell";
import { unreadCount } from "@/lib/notifications";
import { monimeOfferedTo } from "@/lib/monime";

export const metadata: Metadata = { title: "Request" };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ accepted?: string; error?: string; confirmed?: string; concern?: string; payment?: string }>;
}) {
  const farmer = await requireFarmer();
  const { id } = await params;
  const flags = await searchParams;

  const request = await getById(id);
  if (!request || request.farmerId !== farmer.id) notFound(); // never reveal another farmer's request


  return (
    <Shell
      crumb={{ label: "My requests", icon: "requests" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      {/* A full page, not a window over the list: this is where a farmer follows everything that
          happens to the request, so it gets the room to show it (Joseph, 25 Nov 2026). */}
      <div className="req-hub">
        <RequestDetail
          request={request}
          flags={flags}
          online={monimeOfferedTo(farmer.email)}
          links={{
            close: "/farmer/requests",
            edit: `/farmer/requests/${request.id}/edit`,
            again: `/farmer/book?again=${request.id}`,
            payments: "/farmer/payments",
            invoice: `/farmer/requests/${request.id}/invoice`,
          }}
        />
      </div>
    </Shell>
  );
}
