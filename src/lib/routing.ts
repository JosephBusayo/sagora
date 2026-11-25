import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { coverageOf } from "./coverage";
import { serviceLabelOf } from "./catalogue";

/**
 * Why each provider did or did not hear about a request.
 *
 * Karim's handover, 23 November 2026 (A01): "Log every routing decision — eligible, notified or
 * excluded, and why — and make it visible to an administrator."
 *
 * It is cheap and it pays for itself the first time a request goes missing, as one already has: a
 * planting request in Bombali was invisible to an approved Bombali provider, and answering that
 * took a terminal and a script. `scripts/why-no-match.mts` still reconstructs the decision, but
 * only against coverage *as it stands now* — which is no help at all when the question is "why did
 * nobody quote this last month" and the coverage has been edited since.
 *
 * Two rules:
 *
 *  - **It records, it never decides.** Nothing reads this table to work out who should see a
 *    request; `browse` and `providersCovering` do that from coverage, as they always have. A log
 *    that fed back into the decision could drift out of step with it, and then neither would be
 *    trustworthy.
 *  - **Writing it never breaks the request.** A farmer's request succeeding must not depend on an
 *    audit row, so every failure here is caught and logged rather than thrown. The log going
 *    missing is a nuisance; a request failing because of it would be a fault.
 */

export type Outcome = "notified" | "eligible" | "excluded";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  notified: "Told about it",
  eligible: "Could have quoted, not told",
  excluded: "Not eligible",
};

export type Decision = {
  businessId: string; businessName: string; outcome: Outcome; reason: string; decidedAt: string;
};

/**
 * Works out, and records, where one request was offered.
 *
 * Called after the request exists, with the providers that were actually emailed. Every other
 * approved business gets a row too, with the reason it was passed over — which is the half that
 * matters, because "nobody was told" and "four were told and none answered" are different
 * problems with different fixes.
 */
export async function recordRouting(
  request: { id: string; district: string; service: string; services?: string[]; directTo?: string | null },
  notified: readonly string[],
): Promise<number> {
  try {
    const stages = request.services?.length ? request.services : [request.service];
    const now = new Date().toISOString();

    // district and services come along because coverageOf falls back to them for a business with
    // no coverage rows of its own yet — the same fallback the real routing uses.
    const businesses = await db.all(`SELECT id, name, status, email, district, services FROM provider_business`) as
      { id: string; name: string; status: string; email: string; district: string; services: string }[];

    const rows: { businessId: string; outcome: Outcome; reason: string }[] = [];
    for (const b of businesses) {
      if (b.status !== "approved") {
        rows.push({ businessId: b.id, outcome: "excluded", reason: `not approved yet (${b.status})` });
        continue;
      }
      // A direct request belongs to one business and is never opened up to the others.
      if (request.directTo && request.directTo !== b.id) {
        rows.push({ businessId: b.id, outcome: "excluded", reason: "the farmer sent this request to one provider" });
        continue;
      }

      const areas = (await coverageOf({
        id: b.id, district: b.district,
        services: (() => { try { return JSON.parse(b.services) as string[]; } catch { return []; } })(),
      })).areas;
      const missing = stages.filter(
        (service) => !areas.some((a) => a.district === request.district && a.service === service));
      if (missing.length) {
        // Named in full, because this is the reason a request goes missing and a one-word answer
        // sends somebody back to the terminal.
        rows.push({
          businessId: b.id, outcome: "excluded",
          reason: stages.length > 1
            ? `does not cover ${missing.map((m) => serviceLabelOf(m).toLowerCase()).join(" or ")} in ${request.district}, and a package needs every stage`
            : `does not cover ${serviceLabelOf(request.service).toLowerCase()} in ${request.district}`,
        });
        continue;
      }

      if (notified.includes(b.id)) {
        rows.push({ businessId: b.id, outcome: "notified", reason: "" });
      } else {
        rows.push({
          businessId: b.id, outcome: "eligible",
          reason: b.email ? "eligible, but no notice was sent" : "no email address on file",
        });
      }
    }

    for (const r of rows) {
      await db.run(`INSERT INTO routing_decision (id, request_id, business_id, outcome, reason, decided_at)
           VALUES (?,?,?,?,?,?)
         ON CONFLICT (request_id, business_id) DO UPDATE SET
           outcome=excluded.outcome, reason=excluded.reason, decided_at=excluded.decided_at`,
        randomUUID(), request.id, r.businessId, r.outcome, r.reason, now);
    }
    return rows.length;
  } catch (err) {
    // A request must never fail because its audit row did not write.
    console.error("routing_decision write failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** The decision for one request, for the admin screen. Excluded last: the eligible ones matter most. */
export async function routingFor(requestId: string): Promise<Decision[]> {
  const rows = await db.all(`SELECT d.business_id, d.outcome, d.reason, d.decided_at,
         COALESCE(b.name, 'A provider that no longer exists') AS name
       FROM routing_decision d
       LEFT JOIN provider_business b ON b.id = d.business_id
       WHERE d.request_id=?
       ORDER BY CASE d.outcome WHEN 'notified' THEN 0 WHEN 'eligible' THEN 1 ELSE 2 END, name`,
    requestId) as { business_id: string; outcome: Outcome; reason: string; decided_at: string; name: string }[];
  return rows.map((r) => ({
    businessId: r.business_id, businessName: r.name, outcome: r.outcome,
    reason: r.reason, decidedAt: r.decided_at,
  }));
}

/** One line for a list screen: "3 told, 1 eligible, 2 not eligible". */
export function summarise(decisions: readonly Decision[]): string {
  if (decisions.length === 0) return "No routing decision recorded";
  const n = (o: Outcome) => decisions.filter((d) => d.outcome === o).length;
  const parts: string[] = [];
  if (n("notified")) parts.push(`${n("notified")} told`);
  if (n("eligible")) parts.push(`${n("eligible")} eligible but not told`);
  if (n("excluded")) parts.push(`${n("excluded")} not eligible`);
  return parts.join(", ");
}

/**
 * Requests nobody could have quoted, newest first.
 *
 * The question this is really for: is Sagora quietly dropping work because no provider covers it?
 * A request with no eligible provider is a coverage gap, and a coverage gap is a thing staff can
 * act on — by recruiting, or by asking an existing provider to extend.
 */
export async function unroutedRequests(limit = 50): Promise<
  { requestId: string; reference: string; service: string; district: string; createdAt: string }[]
> {
  const rows = await db.all(`SELECT sr.id, sr.reference, sr.service, sr.district, sr.created_at
       FROM service_request sr
       -- Only a request still waiting for its first quote. One that has been quoted, accepted or
       -- started is not a coverage gap whatever the routing log says about the day it was made —
       -- somebody reached it, through the direct provider link or through staff — and listing it
       -- sends a coordinator chasing coverage for work already under way.
       WHERE sr.status = 'awaiting_quotes'
         AND EXISTS (SELECT 1 FROM routing_decision d WHERE d.request_id = sr.id)
         AND NOT EXISTS (
           SELECT 1 FROM routing_decision d
            WHERE d.request_id = sr.id AND d.outcome IN ('notified','eligible'))
       ORDER BY sr.created_at DESC LIMIT ?`, limit) as
    { id: string; reference: string; service: string; district: string; created_at: string }[];
  return rows.map((r) => ({
    requestId: r.id, reference: r.reference, service: r.service, district: r.district, createdAt: r.created_at,
  }));
}
