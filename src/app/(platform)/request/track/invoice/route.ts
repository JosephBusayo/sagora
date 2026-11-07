import { notFound } from "next/navigation";
import { guestRequest } from "@/lib/guest";
import { invoiceResponse } from "@/lib/request-invoice";

/** The invoice for a request sent without an account, for the browser that holds its tracking code. */
export async function GET() {
  const request = await guestRequest();
  if (!request) notFound();
  return (await invoiceResponse(request.id, request.contactName)) ?? notFound();
}
