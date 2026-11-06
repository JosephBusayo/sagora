import "server-only";
import { districtLabel, listForReview } from "./business";
import { awaitingPayment } from "./payments";
import { listAssisted, serviceLabel, type ServiceRequest } from "./requests";

export type StaffResults = {
  assisted: ServiceRequest[];
  providers: { id: string; name: string; sub: string }[];
  payments: { requestId: string; reference: string; businessName: string }[];
};

/**
 * The staff search box looks only where staff have a screen to send someone: assisted requests,
 * providers waiting for review, and agreed jobs on the payments screen.
 */
export async function searchForStaff(q: string): Promise<StaffResults> {
  const term = q.trim().toLowerCase();
  if (!term) return { assisted: [], providers: [], payments: [] };
  const has = (...values: (string | null | undefined)[]) => values.some((v) => (v ?? "").toLowerCase().includes(term));

  const assisted = (await listAssisted())
    .filter((r) => has(r.reference, r.contactName, r.contactPhone, r.callerName, r.mayAccept, r.village, districtLabel(r.district), serviceLabel(r.service)))
    .slice(0, 25);
  const providers = (await listForReview())
    .filter((b) => has(b.name, b.email, b.ownerEmail, b.phone, b.town, b.district))
    .slice(0, 25)
    .map((b) => ({ id: b.id, name: b.name, sub: `${b.town}, ${b.district}` }));
  const payments = (await awaitingPayment())
    .filter((p) => has(p.reference, p.businessName))
    .slice(0, 25)
    .map((p) => ({ requestId: p.requestId, reference: p.reference, businessName: p.businessName }));
  return { assisted, providers, payments };
}
