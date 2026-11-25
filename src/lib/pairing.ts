import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";
import { getSetting } from "./follow-ups";
import { article, canPower, implementKindsFor, isSelfContainedFor, kindLabelOf, kitFor, kitSentence, serviceLabelOf } from "./catalogue";
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
 * Two quite different refusals come out of here, and conflating them was a real bug: until
 * migration 029 both were gated behind `pairing_enforced`, so with the switch off a provider could
 * send a quote with a machine that physically cannot do the work and then find they could not
 * schedule the job they had won — `scheduleJob` has always enforced the kit requirement hard.
 *
 *  - `pairing: false` — **the catalogue**. Ploughing needs a tractor and a plough. That is a fact
 *    about the work, not a judgement about two particular machines, and nothing is waiting on
 *    Karim for it. It always blocks.
 *  - `pairing: true` — **the judgement**. Whether *this* plough goes behind *this* tractor. Nobody
 *    has recorded a pairing yet, so enforcing it today would stop every quote on the platform; it
 *    blocks only while `pairing_enforced` is on, and is said rather than enforced until then.
 *
 * Whether the machines are free for the dates is a third question entirely, answered in
 * lib/holds.ts inside the transaction that writes the hold.
 */
/**
 * Why a quote cannot go out, and whose problem it is.
 *
 * `cause` exists because four quite different situations used to come out of here reading the
 * same, and a provider cannot act on "equipment error" (Joseph, 25 Nov 2026):
 *
 *  - `none_registered` — nothing on their register can do this work at all. The answer is to add
 *    a machine, and the message says which kind.
 *  - `awaiting_approval` — they have the right machine and Sagora has not approved it yet. The
 *    answer is to wait, and nothing they do to the quote will help.
 *  - `unavailable` — the right machine is theirs and approved, but it is broken, under repair or
 *    off lease. The answer is on the Equipment screen.
 *  - `wrong_kit` — what they actually ticked cannot do the work. The answer is to tick something
 *    else, and the message says what is missing.
 *  - `pairing` — the kit is right but nobody has confirmed those two particular machines go
 *    together. The only one gated behind `pairing_enforced`.
 */
export type KitCause = "none_registered" | "awaiting_approval" | "unavailable" | "wrong_kit" | "pairing";

export type KitProblem = { why: string; pairing: boolean; cause: KitCause };

const kitFault = (why: string, cause: KitCause = "wrong_kit"): KitProblem => ({ why, pairing: false, cause });
const pairingFault = (why: string): KitProblem => ({ why, pairing: true, cause: "pairing" });

/**
 * The same question asked of the whole register rather than of one quote: can this business do
 * this work with anything it owns, and if not, why not?
 *
 * Answered before the chosen equipment is judged, so "you have no harvester" is never dressed up
 * as "the equipment you chose is wrong".
 */
async function registerProblem(businessId: string, service: string): Promise<KitProblem | null> {
  const all = await listAssets(businessId);
  const live = all.filter((a) => a.condition !== "retired" && a.status !== "retired");
  const relevant = (a: Asset) => canPower(service, a.kind) || implementKindsFor(service).includes(a.kind);
  const usable = live.filter((a) => relevant(a) && a.review === "approved" && unavailableReason(a) === null);
  if (usable.length > 0) return null;

  const work = serviceLabelOf(service).toLowerCase();
  const waiting = live.filter((a) => relevant(a) && a.review === "pending");
  if (waiting.length > 0) {
    return kitFault(
      `${waiting.map((a) => a.name).join(" and ")} ${waiting.length === 1 ? "is" : "are"} still waiting for Sagora to approve ` +
      `${waiting.length === 1 ? "it" : "them"}. You can quote for ${work} as soon as that is done.`,
      "awaiting_approval");
  }
  const refused = live.filter((a) => relevant(a) && a.review === "rejected");
  if (refused.length > 0) {
    return kitFault(
      `${refused.map((a) => a.name).join(" and ")} was not approved by Sagora. Open it on the Equipment screen to see why, ` +
      "put it right and send it back.",
      "awaiting_approval");
  }
  const blocked = live.filter((a) => relevant(a) && a.review === "approved" && unavailableReason(a) !== null);
  if (blocked.length > 0) {
    return kitFault(
      blocked.map((a) => `${a.name} — ${(unavailableReason(a) ?? "").toLowerCase()}`).join("; ") +
      `. Nothing you can put on ${work} is available at the moment.`,
      "unavailable");
  }
  return kitFault(
    `You have no equipment registered for ${work}. It takes ${kitSentence(service)}.`,
    "none_registered");
}

export async function kitProblem(
  businessId: string, service: string, assetIds: readonly string[],
): Promise<KitProblem | null> {
  // First: is this even possible for this business? A provider with no plough at all should be
  // told that, not told that the tractor they ticked is the wrong thing to tick.
  const register = await registerProblem(businessId, service);
  if (register) return register;

  if (assetIds.length === 0) return kitFault("Choose the equipment for this work.");
  const assets = (await listAssets(businessId)).filter((a) => assetIds.includes(a.id));
  if (assets.length !== assetIds.length) return kitFault("Some of that equipment is not on your register.");

  const kit = kitFor(service);
  const powered = assets.filter((a) => canPower(service, a.kind));
  if (powered.length === 0) {
    return kitFault(
      `${serviceLabelOf(service)} takes ${kitSentence(service)}. None of the equipment you chose can do it.`);
  }

  // A self-contained unit among them settles it: no implement is required alongside.
  if (powered.some((a) => isSelfContainedFor(service, a.kind))) return null;

  const pairings = await pairingsFor(businessId);
  for (const group of kit.implements) {
    const chosen = assets.filter((a) => group.includes(a.kind));
    if (chosen.length === 0) {
      return kitFault(`${serviceLabelOf(service)} needs ${article(group.map(kindLabelOf).join(" or ").toLowerCase())}. Add one to this quote.`);
    }
    // At least one machine-and-implement pair among those chosen has to be verified.
    const anyVerified = powered.some((m) => chosen.some((c) =>
      pairings.some((p) => p.machineId === m.id && p.implementId === c.id && p.service === service && p.verdict === "compatible")));
    if (anyVerified) continue;

    const refused = powered.some((m) => chosen.some((c) =>
      pairings.some((p) => p.machineId === m.id && p.implementId === c.id && p.service === service && p.verdict === "incompatible")));
    const names = chosen.map((c) => c.name).join(" or ");
    return pairingFault(refused
      ? `${names} is recorded as not compatible with the machine you chose for ${serviceLabelOf(service).toLowerCase()}.`
      : `Nobody has confirmed that ${names} fits the machine you chose for ${serviceLabelOf(service).toLowerCase()}. ` +
        "Record the pairing on the Equipment screen first.");
  }
  return null;
}

/** The implements a provider owns that could go with this service, for offering a choice. */
export async function implementChoices(businessId: string, service: string): Promise<Asset[]> {
  const kinds = implementKindsFor(service);
  return (await listAssets(businessId)).filter((a) => kinds.includes(a.kind) && a.condition !== "retired");
}
