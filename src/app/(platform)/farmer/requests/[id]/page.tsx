import { ModalShell } from "@/components/app/ModalShell";
import { FarmerRequestsList } from "@/components/requests/FarmerRequestsList";
import { pageOf } from "@/components/app/Pager";
import { RequestDetail } from "@/components/requests/RequestDetail";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { getById, listForFarmer } from "@/lib/requests";
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

  // The list behind the window: its first page, as the My requests screen opens.
  const { rows, pages } = pageOf(await listForFarmer(farmer.id), "1");

  return (
    <Shell
      crumb={{ label: "My requests", icon: "requests" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <FarmerRequestsList rows={rows} page={1} pages={pages} />
      {/* The request opens over the list, as every detail window in the design does. */}
      <ModalShell closeHref="/farmer/requests" label="Request details" className="modal--request-page">
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
      </ModalShell>
    </Shell>
  );
}
