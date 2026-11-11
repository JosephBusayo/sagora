import "server-only";
import { db } from "./db";
import { notify } from "./outbox";

/** Who to tell about money, looked up rather than passed in a form. */
export async function contactsFor(requestId: string) {
  // The quotes around the aliases are not decoration. Postgres folds an unquoted identifier to
  // lower case, so an unquoted alias arrives flattened — "farmeremail" rather than the name the
  // code reads — and the value comes back undefined. Here that would mean the booking
  // confirmation quietly never sends while the screen still says the job is booked.
  // `npm run check:sql` fails the build if one of these loses its quotes again.
  return (await db.get(`SELECT r.reference AS reference, r.contact_email AS "farmerEmail", b.email AS "providerEmail", b.name AS "providerName"
       FROM service_request r
       LEFT JOIN agreement a ON a.request_id = r.id
       LEFT JOIN provider_business b ON b.id = a.business_id
       WHERE r.id = ?`, requestId)) as
    | { reference: string; farmerEmail: string | null; providerEmail: string | null; providerName: string | null }
    | undefined;
}

/** Booking confirmation is one of the emails the brief requires. Sent once per booking. */
export async function tellBooked(requestId: string, how: "manual" | "monime") {
  const who = await contactsFor(requestId);
  if (!who) return;
  if (who.farmerEmail) {
    await notify({
      kind: "booking.confirmed",
      dedupeKey: `booking.confirmed:farmer:${requestId}`,
      to: who.farmerEmail,
      subject: `${who.reference} is booked`,
      text:
        `Enough of your payment for ${who.reference} has been received and the work is booked.\n\n` +
        `${who.providerName ?? "The provider"} has the equipment committed for your dates. ` +
        `You will be asked to confirm the work once it is done.\n\n` +
        (how === "monime"
          ? `You paid online through Monime, Sagora's payment provider.`
          : `This payment was recorded by hand by our team, not by a payment provider.`),
    });
  }
  if (who.providerEmail) {
    await notify({
      kind: "booking.confirmed",
      dedupeKey: `booking.confirmed:provider:${requestId}`,
      to: who.providerEmail,
      subject: `${who.reference} is paid and booked`,
      text:
        `${who.reference} is now booked — enough of the agreed price has been received, though not ` +
        `necessarily all of it (Sagora can confirm a booking on a deposit). The equipment you ` +
        `scheduled is committed for those dates. Check your Payments screen for exactly what has ` +
        `come in.\n\nYou are paid once the farmer confirms the work.`,
    });
  }
}
