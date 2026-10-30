import { notFound } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { db } from "@/lib/db";
import { invoicePdf } from "@/lib/invoice";
import { formatAmount } from "@/lib/money";
import { agreementFor } from "@/lib/quotes";
import { bookingFor, methodLabel, paymentsFor } from "@/lib/payments";
import { getById, serviceLabel } from "@/lib/requests";

/** The invoice for a booked job, for the farmer who owns it and nobody else. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const farmer = await requireFarmer();
  const { id } = await params;
  const request = await getById(id);
  if (!request || request.farmerId !== farmer.id) notFound();
  const agreement = await agreementFor(id);
  const booking = await bookingFor(id);
  if (!agreement || !booking) notFound();

  const provider = (await db.get("SELECT name FROM provider_business WHERE id=?", agreement.businessId)) as { name: string } | undefined;
  const payments = await paymentsFor(id);
  const pdf = invoicePdf({
    title: `Sagora invoice ${request.reference}`,
    lines: [
      { label: "Date", value: booking.confirmedAt.slice(0, 10) },
      { label: "Farmer", value: farmer.name },
      { label: "Provider", value: provider?.name ?? "" },
      { label: "Service", value: `${serviceLabel(request.service)}, ${request.acres} acres` },
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
