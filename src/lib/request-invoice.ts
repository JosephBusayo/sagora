import "server-only";
import { districtLabel } from "./business";
import { db } from "./db";
import { invoicePdf } from "./invoice";
import { formatAmount } from "./money";
import { agreementFor } from "./quotes";
import { bookingFor, methodLabel, paymentsFor } from "./payments";
import { getById, serviceLabel } from "./requests";
import { landSize } from "./land-size";

/**
 * The invoice for a booked job, as a PDF download, or null when there is nothing to invoice yet.
 * The caller decides who may have it: the farmer's own account, or the browser holding its tracking code.
 */
export async function invoiceResponse(requestId: string, farmerName: string): Promise<Response | null> {
  const request = await getById(requestId);
  if (!request) return null;
  const agreement = await agreementFor(requestId);
  const booking = await bookingFor(requestId);
  if (!agreement || !booking) return null;

  const provider = (await db.get("SELECT name FROM provider_business WHERE id=?", agreement.businessId)) as { name: string } | undefined;
  const payments = await paymentsFor(requestId);
  const pdf = invoicePdf({
    title: `Sagora invoice ${request.reference}`,
    lines: [
      { label: "Date", value: booking.confirmedAt.slice(0, 10) },
      { label: "Farmer", value: farmerName },
      { label: "Provider", value: provider?.name ?? "" },
      { label: "Service", value: `${serviceLabel(request.service)}, ${landSize(request.acres)}` },
      ...(request.crop ? [{ label: "Crop", value: request.crop }] : []),
      { label: "Location", value: `${request.village}, ${districtLabel(request.district)}` },
      { label: "Covers", value: agreement.includes },
      { label: "Agreed price", value: formatAmount(agreement.amountMinor) },
      ...payments.map((p) => ({ label: `Paid by ${methodLabel(p.method)}`, value: `${formatAmount(p.amountMinor)} (${p.externalRef})` })),
    ],
    footer: ["Payments are recorded by the Sagora team from your receipt, not by an automatic payment provider yet."],
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="sagora-${request.reference}.pdf"`,
    },
  });
}
