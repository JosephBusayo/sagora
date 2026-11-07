import "server-only";
import { requireFarmer } from "./session";
import { guestRequestId } from "./guest";
import { getById, guestActor } from "./requests";

/** Whoever is acting on a request as its farmer: a signed-in farmer, or a guest who came in with its tracking code. */
export type Requester = {
  actor: string;
  email: string;
  name: string;
  guest: boolean;
  /** Where the request is shown to them. */
  page: string;
  /** Where Monime sends them back after paying. */
  paidPath: string;
};

export async function requesterFor(requestId: string): Promise<Requester> {
  const letIn = await guestRequestId();
  if (letIn && letIn === requestId) {
    const r = await getById(letIn);
    return {
      actor: guestActor(letIn), email: r?.contactEmail ?? "", name: r?.contactName ?? "", guest: true,
      page: "/request/track", paidPath: "/request/track/paid",
    };
  }
  const farmer = await requireFarmer();
  return {
    actor: farmer.id, email: farmer.email, name: farmer.name, guest: false,
    page: `/farmer/requests/${requestId}`, paidPath: `/farmer/requests/${requestId}/paid`,
  };
}
