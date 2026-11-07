import { notFound } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { getById } from "@/lib/requests";
import { invoiceResponse } from "@/lib/request-invoice";

/** The invoice for a booked job, for the farmer who owns it and nobody else. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const farmer = await requireFarmer();
  const { id } = await params;
  const request = await getById(id);
  if (!request || request.farmerId !== farmer.id) notFound();
  return (await invoiceResponse(id, farmer.name)) ?? notFound();
}
