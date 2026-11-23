import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";
import { getSetting } from "./follow-ups";
import { canPower, implementKindsFor, isSelfContainedFor, kindLabelOf, kitFor, serviceLabelOf } from "./catalogue";
import { listAssets, unavailableReason, type Asset } from "./equipment";

/**
 * Whether a particular machine and a particular implement actually go together, and what a
 * provider is therefore ready to do.
 *
 * Karim's handover, 23 November 2026, on both halves of this:
 *
 *   "Record Compatible, Needs checking or Not compatible, with reviewer, date and supporting
 *    machine/implement information. Unknown critical details block the affected service."
 *   "Show readiness per service: Ploughing ready, Harrowing missing a harrow, or Compatibility
 *    needs checking. Readiness still needs a fresh date-specific capacity check before quotation."
 *
 * That last sentence draws the line this file sits on. Readiness is about *kit*: does this
 * provider own the right things, and do they fit each other. It says nothing about whether those
 * things are free next Tuesday — that is lib/holds.ts, and it is checked separately every time.
 * A provider can be perfectly ready for ploughing and still unable to quote a particular week.
 */

export type Verdict = "compatible" | "checking" | "incompatible";

export const VERDICTS: readonly { id: Verdict; label: string }[] = [
  { id: "compatible", label: "Compatible" },
  { id: "checking", label: "Needs checking" },
  { id: "incompatible", label: "Not compatible" },
];

export type Pairing = {
  id: string; businessId: string; machineId: string; implementId: string; service: string;
  verdict: Verdict; basis: string; decidedBy: string; decidedAt: string;
};

type Row = {
  id: string; business_id: string; machine_id: string; implement_id: string; service: string;
  verdict: Verdict; basis: string; decided_by: string; decided_at: string;
};

const fromRow = (r: Row): Pairing => ({
  id: r.id, businessId: r.business_id, machineId: r.machine_id, implementId: r.implement_id,
  service: r.service, verdict: r.verdict, basis: r.basis, decidedBy: r.decided_by, decidedAt: r.decided_at,
});

/**
 * Whether an unverified pairing actually stops a quote going out.
 *
 * The handover says it should. Switching that on the day it is built would stop every provider
 * already on Sagora from quoting, because none of them has recorded a pairing yet — and the
 * handover equally forbids the shortcut that would avoid it, since auto-approving every pairing
 * of the right type is exactly the "generic type as an engineering approval" it warns against.
 *
 * So it is a setting. Off, a missing pairing is shown everywhere as "needs checking" and warned
 * about; on, it refuses. Karim turns it on once providers have recorded their kit. Recorded in
 * WAITING-ON.md as a question with a date, not as a decision taken quietly here.
 */
export async function pairingEnforced(): Promise<boolean> {
  return (await getSetting("pairing_enforced")) === "yes";
}

/* ------------------------------------------------------------------ recording */

export async function pairingsFor(businessId: string, machineId?: string): Promise<Pairing[]> {
  const rows = machineId
    ? await db.all("SELECT * FROM asset_pairing WHERE business_id=? AND machine_id=? ORDER BY service", businessId, machineId)
    : await db.all("SELECT * FROM asset_pairing WHERE business_id=? ORDER BY machine_id, service", businessId);
  return (rows as Row[]).map(fromRow);
}

export type PairingInput = { machineId: string; implementId: string; service: string; verdict: Verdict; basis: string };

/**
 * Records one judgement. The decider and the day are kept with it, because an approval nobody
 * owns is not an approval — and because a machine's specifications can change afterwards, at
 * which point the pairing needs looking at again (see `staleAfterSpecChange`).
 */
export async function savePairing(businessId: string, actorId: string, input: PairingInput): Promise<boolean> {
  // Both halves must be this business's own, and must be real.
  const owned = await db.all(`SELECT id FROM equipment WHERE business_id=? AND id IN (?,?)`,
    businessId, input.machineId, input.implementId) as { id: string }[];
  if (owned.length !== 2) return false;
  if (input.machineId === input.implementId) return false;

  const now = new Date().toISOString();
  await db.run(`INSERT INTO asset_pairing (id, business_id, machine_id, implement_id, service, verdict, basis,
       decided_by, decided_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (machine_id, implement_id, service) DO UPDATE SET
       verdict=excluded.verdict, basis=excluded.basis, decided_by=excluded.decided_by,
       decided_at=excluded.decided_at, updated_at=excluded.updated_at`,
    randomUUID(), businessId, input.machineId, input.implementId, input.service, input.verdict, input.basis,
    actorId, now, now, now);
  await audit(actorId, "pairing.recorded", `${input.machineId}:${input.implementId}`, `${input.service} ${input.verdict}`);
  return true;
}

/**
 * Sends every pairing a machine is part of back for checking.
 *
 * "Changing a critical specification triggers recheck without deleting booked work" (A12). A
 * tractor whose lift capacity was corrected is not the tractor the plough was approved against,
 * so the approval lapses — but the verdicts are reset rather than removed, keeping the history of
 * who said what.
 */
export async function recheckAfterSpecChange(businessId: string, machineId: string, actorId: string): Promise<number> {
  const res = await db.run(`UPDATE asset_pairing SET verdict='checking', basis='', decided_by='', decided_at='', updated_at=?
       WHERE business_id=? AND (machine_id=? OR implement_id=?) AND verdict<>'checking'`,
    new Date().toISOString(), businessId, machineId, machineId);
  if (res.changes) await audit(actorId, "pairing.recheck", machineId, `${res.changes} pairings`);
  return res.changes;
}

/* ------------------------------------------------------------------ readiness */

export type Readiness = {
  service: string;
  serviceLabel: string;
  ready: boolean;
  /** "Ploughing ready", "Harrowing missing a harrow", "Compatibility needs checking". */
  summary: string;
  /** The machines and implements that make this service possible, when it is. */
  usableWith: { machineId: string; implementId: string | null }[];
};

/**
 * What one business can actually do, service by service.
 *
 * Worked out from the register rather than from what a provider claims: a business that has
 * ticked "harrowing" on its profile but owns no harrow is not ready for harrowing, and saying so
 * here is kinder than letting them quote and fail.
 */
export async function readinessFor(businessId: string, services: readonly string[]): Promise<Readiness[]> {
  const assets = (await listAssets(businessId)).filter((a) => a.condition !== "retired");
  const pairings = await pairingsFor(businessId);
  return services.map((service) => readinessOf(service, assets, pairings));
}

function readinessOf(service: string, assets: readonly Asset[], pairings: readonly Pairing[]): Readiness {
  const label = serviceLabelOf(service);
  const kit = kitFor(service);
  const usable: Readiness["usableWith"] = [];

  // Nothing with an engine that can do this work.
  const powered = assets.filter((a) => canPower(service, a.kind) && unavailableReason(a) === null);
  if (powered.length === 0) {
    const wanted = [...kit.power, ...(kit.selfContained ?? [])];
    const haveButBlocked = assets.some((a) => canPower(service, a.kind));
    return {
      service, serviceLabel: label, ready: false, usableWith: [],
      summary: haveButBlocked
        ? `${label} — the machine for it is not available`
        : `${label} needs ${wanted.map(kindLabelOf).join(" or ").toLowerCase() || "a machine"}`,
    };
  }

  // A unit that does the job alone needs nothing hitched to it.
  const soloists = powered.filter((a) => isSelfContainedFor(service, a.kind));
  for (const m of soloists) usable.push({ machineId: m.id, implementId: null });

  // Everything else needs one implement from each group the kit names.
  let missingKind: string | null = null;
  let needsChecking = false;

  for (const m of powered.filter((a) => !isSelfContainedFor(service, a.kind))) {
    let satisfiedAll = true;
    for (const group of kit.implements) {
      const candidates = assets.filter((a) => group.includes(a.kind) && unavailableReason(a) === null);
      if (candidates.length === 0) {
        satisfiedAll = false;
        missingKind ??= group[0] ?? null;
        continue;
      }
      // Of those, one must be recorded as compatible with this machine for this service.
      const verified = candidates.find((c) =>
        pairings.some((p) => p.machineId === m.id && p.implementId === c.id && p.service === service && p.verdict === "compatible"));
      if (!verified) {
        satisfiedAll = false;
        needsChecking = true;
        continue;
      }
      usable.push({ machineId: m.id, implementId: verified.id });
    }
    if (!satisfiedAll) continue;
  }

  if (usable.length > 0) return { service, serviceLabel: label, ready: true, summary: `${label} ready`, usableWith: usable };
  if (missingKind) {
    return {
      service, serviceLabel: label, ready: false, usableWith: [],
      summary: `${label} missing ${kindLabelOf(missingKind).toLowerCase()}`,
    };
  }
  if (needsChecking) {
    return { service, serviceLabel: label, ready: false, usableWith: [], summary: `${label} — compatibility needs checking` };
  }
  return { service, serviceLabel: label, ready: false, usableWith: [], summary: `${label} not ready` };
}

/* ----------------------------------------------------- the gate on a quotation */

/**
 * Why this set of machines cannot do this work, or null when it can.
 *
 * Called when a quote is sent. It answers the kit question only — whether the machines are free
 * for the dates is lib/holds.ts, checked in the same transaction that writes the hold.
 *
 * While `pairing_enforced` is off this returns a warning rather than a refusal, so the caller can
 * show it without stopping the quote. See `pairingEnforced` for why that switch exists.
 */
export async function kitProblem(
  businessId: string, service: string, assetIds: readonly string[],
): Promise<string | null> {
  if (assetIds.length === 0) return "Choose the equipment for this work.";
  const assets = (await listAssets(businessId)).filter((a) => assetIds.includes(a.id));
  if (assets.length !== assetIds.length) return "Some of that equipment is not on your register.";

  const kit = kitFor(service);
  const powered = assets.filter((a) => canPower(service, a.kind));
  if (powered.length === 0) {
    const wanted = [...kit.power, ...(kit.selfContained ?? [])].map(kindLabelOf).join(" or ");
    return `${serviceLabelOf(service)} needs ${wanted.toLowerCase() || "a suitable machine"}. None of the equipment you chose can do it.`;
  }

  // A self-contained unit among them settles it: no implement is required alongside.
  if (powered.some((a) => isSelfContainedFor(service, a.kind))) return null;

  const pairings = await pairingsFor(businessId);
  for (const group of kit.implements) {
    const chosen = assets.filter((a) => group.includes(a.kind));
    if (chosen.length === 0) {
      return `${serviceLabelOf(service)} needs ${group.map(kindLabelOf).join(" or ").toLowerCase()}. Add one to this quote.`;
    }
    // At least one machine-and-implement pair among those chosen has to be verified.
    const anyVerified = powered.some((m) => chosen.some((c) =>
      pairings.some((p) => p.machineId === m.id && p.implementId === c.id && p.service === service && p.verdict === "compatible")));
    if (anyVerified) continue;

    const refused = powered.some((m) => chosen.some((c) =>
      pairings.some((p) => p.machineId === m.id && p.implementId === c.id && p.service === service && p.verdict === "incompatible")));
    const names = chosen.map((c) => c.name).join(" or ");
    return refused
      ? `${names} is recorded as not compatible with the machine you chose for ${serviceLabelOf(service).toLowerCase()}.`
      : `Nobody has confirmed that ${names} fits the machine you chose for ${serviceLabelOf(service).toLowerCase()}. ` +
        "Record the pairing on the Equipment screen first.";
  }
  return null;
}

/** The implements a provider owns that could go with this service, for offering a choice. */
export async function implementChoices(businessId: string, service: string): Promise<Asset[]> {
  const kinds = implementKindsFor(service);
  return (await listAssets(businessId)).filter((a) => kinds.includes(a.kind) && a.condition !== "retired");
}
