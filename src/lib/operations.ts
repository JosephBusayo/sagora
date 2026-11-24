import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { inFieldOrder, isActiveService, orderOf, serviceLabelOf } from "./catalogue";

/**
 * A request as a list of operations rather than a single service.
 *
 * Karim's handover, 23 November 2026: "For a package such as ploughing and harrowing, plan each
 * operation and reserve its resources for its own window. All stages must be covered before the
 * package is quoted."
 *
 * The design decision behind this file, taken 24 November 2026: **every** request is a list, and
 * a single-service request is a list of one. The alternative — a separate "package" path alongside
 * the existing one — would have meant two sources of scheduling truth, which is the exact fault the
 * handover criticises elsewhere ("private work recorded outside the booking flow is a second source
 * of scheduling truth"). One model, used everywhere.
 *
 * What that buys, concretely: `service_request.service` keeps its meaning as the first operation,
 * so the hundred-odd places that read it carry on working untouched, and no screen had to learn
 * about two kinds of request.
 *
 * Three rules this file holds:
 *
 *  - **Order is agronomic, not chosen.** You cannot harrow a field you have not ploughed, so the
 *    sequence comes from the catalogue (`inFieldOrder`) and not from the order the farmer ticked
 *    the boxes. See `orderOf` in lib/catalogue.ts.
 *  - **The farmer gives one date, not several.** The gap between ploughing and harrowing depends on
 *    the soil and the rain. That is the provider's judgement, and asking a farmer to schedule three
 *    operations would be asking them to do the provider's job.
 *  - **All stages or none.** "All stages must be covered before the package is quoted." A provider
 *    who can plough and harrow but not plant cannot quote a three-stage package at all. Recorded in
 *    WAITING-ON.md, because in a thin market it can mean a package gets no quotes.
 */

export type Operation = {
  id: string;
  requestId: string;
  service: string;
  serviceLabel: string;
  /** 1-based position in the order the work must happen. */
  sequence: number;
  /** Null on almost every row: a package is normally one field worked several times. */
  acres: number | null;
};

type Row = { id: string; request_id: string; service: string; sequence: number; acres: number | null };

const fromRow = (r: Row): Operation => ({
  id: r.id, requestId: r.request_id, service: r.service, serviceLabel: serviceLabelOf(r.service),
  sequence: Number(r.sequence), acres: r.acres === null ? null : Number(r.acres),
});

/** Everything one request asked for, in the order it has to happen. */
export async function operationsFor(requestId: string, t: Queries = db): Promise<Operation[]> {
  const rows = await t.all("SELECT * FROM request_operation WHERE request_id=? ORDER BY sequence", requestId) as Row[];
  return rows.map(fromRow);
}

/** The operations of several requests at once, for a list screen that would otherwise do N queries. */
export async function operationsForMany(requestIds: readonly string[]): Promise<Map<string, Operation[]>> {
  const out = new Map<string, Operation[]>();
  if (requestIds.length === 0) return out;
  const marks = requestIds.map(() => "?").join(",");
  const rows = await db.all(`SELECT * FROM request_operation WHERE request_id IN (${marks})
       ORDER BY request_id, sequence`, ...requestIds) as Row[];
  for (const r of rows) {
    const list = out.get(r.request_id) ?? [];
    list.push(fromRow(r));
    out.set(r.request_id, list);
  }
  return out;
}

/** True when this request is a package rather than a single job. */
export const isPackage = (ops: readonly Operation[]) => ops.length > 1;

/**
 * How a package reads in one line: "Ploughing, then harrowing, then planting".
 *
 * "then" rather than "and" on purpose — the order is part of what was asked for, and a farmer
 * reading their own request back should see that the stages happen in sequence rather than at once.
 */
export function describeOperations(ops: readonly Operation[]): string {
  if (ops.length === 0) return "";
  if (ops.length === 1) return ops[0]!.serviceLabel;
  const labels = ops.map((o, i) => (i === 0 ? o.serviceLabel : o.serviceLabel.toLowerCase()));
  return `${labels.slice(0, -1).join(", ")}, then ${labels.at(-1)}`;
}

/**
 * What a farmer may ask for in one request, and why not.
 *
 * Returns the reason it is refused, or null. Deliberately strict about actives: an inactive service
 * cannot be smuggled into a package when it cannot be asked for on its own.
 */
export function packageProblem(services: readonly string[]): string | null {
  if (services.length === 0) return "Choose at least one service.";
  const unique = [...new Set(services)];
  if (unique.length !== services.length) return "You have chosen the same service twice.";
  // Counted before the services are examined: a farmer who has ticked six things needs to hear
  // "up to four", not a complaint about whichever one happens to be inactive.
  //
  // Not a hard limit so much as a sanity one: beyond this it is a season's plan rather than a job,
  // and the provider cannot hold machines that far ahead in any useful way.
  if (unique.length > MAX_OPERATIONS) {
    return `A single request can cover up to ${MAX_OPERATIONS} services. Send the rest as a second request.`;
  }
  const bad = unique.find((s) => !isActiveService(s));
  if (bad) return `${serviceLabelOf(bad)} is not available yet. Choose from the services offered.`;
  return null;
}

/**
 * The most stages one request may carry.
 *
 * Four covers the land-preparation sequence the handover names and then some — plough, harrow,
 * plant, and one crop-care pass. More than that and the last operation's machines would be held
 * months out on a guess, which is not capacity, it is a wish.
 */
export const MAX_OPERATIONS = 4;

/**
 * Writes the operations for a request. Called inside the transaction that creates it, so a request
 * never exists for even a moment without the stages it asked for.
 *
 * `service_request.service` is set by the caller to the first of these, which is what keeps every
 * existing reader correct: for a single-service request it is the service, and for a package it is
 * the stage that happens first — and therefore the one routing and the dashboard should lead with.
 */
export async function setOperations(
  t: Queries, requestId: string, services: readonly string[], createdAt: string,
): Promise<string[]> {
  const ordered = inFieldOrder(services);
  await t.run("DELETE FROM request_operation WHERE request_id=?", requestId);
  for (const [i, service] of ordered.entries()) {
    await t.run(`INSERT INTO request_operation (id, request_id, service, sequence, acres, created_at)
         VALUES (?,?,?,?,NULL,?)`, randomUUID(), requestId, service, i + 1, createdAt);
  }
  return ordered;
}

/** The service a request leads with: the first stage, which is what `service_request.service` holds. */
export const leadService = (services: readonly string[]): string => inFieldOrder(services)[0] ?? "";

/* --------------------------------------------------------- what a provider must cover */

/**
 * Whether this provider can be offered the whole package.
 *
 * "All stages must be covered before the package is quoted." Coverage is the district-and-service
 * pairing a provider has already declared; this asks whether their declared set contains every
 * stage, not whether their machines are free — that is lib/holds.ts, checked per window.
 */
export function coversEveryStage(covered: readonly string[], ops: readonly Operation[]): boolean {
  return ops.every((o) => covered.includes(o.service));
}

/** The stages a provider cannot do, for telling them why a request is not theirs to quote. */
export const stagesNotCovered = (covered: readonly string[], ops: readonly Operation[]): Operation[] =>
  ops.filter((o) => !covered.includes(o.service));

/* ------------------------------------------------------------ the provider's plan */

export type PlannedOperation = {
  operationId: string;
  service: string;
  sequence: number;
  startDate: string;
  daysToComplete: number;
  dailyRateMinor: number;
  amountMinor: number;
};

export type QuoteOperation = PlannedOperation & { id: string; quoteId: string; serviceLabel: string; endDate: string };

type QRow = {
  id: string; quote_id: string; operation_id: string; service: string; sequence: number;
  start_date: string; days_to_complete: number; daily_rate_minor: number; amount_minor: number;
};

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** The last day one stage runs. One day of work ends the day it starts. */
export const endOfStage = (p: Pick<PlannedOperation, "startDate" | "daysToComplete">) =>
  addDays(p.startDate, Math.max(1, p.daysToComplete) - 1);

const qFromRow = (r: QRow): QuoteOperation => ({
  id: r.id, quoteId: r.quote_id, operationId: r.operation_id, service: r.service,
  serviceLabel: serviceLabelOf(r.service), sequence: Number(r.sequence), startDate: r.start_date,
  daysToComplete: Math.max(1, Number(r.days_to_complete)), dailyRateMinor: Number(r.daily_rate_minor),
  amountMinor: Number(r.amount_minor),
  endDate: endOfStage({ startDate: r.start_date, daysToComplete: Number(r.days_to_complete) }),
});

/** The stage-by-stage plan behind one quote, earliest first. */
export async function planFor(quoteId: string, t: Queries = db): Promise<QuoteOperation[]> {
  const rows = await t.all("SELECT * FROM quote_operation WHERE quote_id=? ORDER BY sequence", quoteId) as QRow[];
  return rows.map(qFromRow);
}

/** Writes a quote's plan. Inside the send transaction, alongside the holds it justifies. */
export async function savePlan(
  t: Queries, quoteId: string, plan: readonly PlannedOperation[], createdAt: string,
): Promise<void> {
  await t.run("DELETE FROM quote_operation WHERE quote_id=?", quoteId);
  for (const p of plan) {
    await t.run(`INSERT INTO quote_operation (id, quote_id, operation_id, service, sequence, start_date,
         days_to_complete, daily_rate_minor, amount_minor, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      randomUUID(), quoteId, p.operationId, p.service, p.sequence, p.startDate,
      Math.max(1, p.daysToComplete), p.dailyRateMinor, p.amountMinor, createdAt);
  }
}

/**
 * Whether a plan actually covers the request, in a workable order.
 *
 * The sequence check is the one that matters and the one a form cannot be trusted to enforce: a
 * provider who plans to harrow on Monday and plough on Thursday has planned to ruin a field, and
 * the server has to say so even though the farmer asked for both and the machines are free.
 */
export function planProblem(ops: readonly Operation[], plan: readonly PlannedOperation[]): string | null {
  if (plan.length === 0) return "Plan the work before sending a price.";
  const planned = new Set(plan.map((p) => p.operationId));
  const missing = ops.filter((o) => !planned.has(o.id));
  if (missing.length > 0) {
    // The handover's all-or-nothing rule, said in the words a provider needs to act on.
    return `Plan every stage before quoting. ${missing.map((m) => m.serviceLabel).join(" and ")} ` +
      `${missing.length === 1 ? "has" : "have"} no dates yet.`;
  }
  if (plan.length !== ops.length) return "That plan covers work this farmer did not ask for.";

  const byStage = [...plan].sort((a, b) => a.sequence - b.sequence);
  for (const p of byStage) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) return "Give every stage a start date.";
    if (p.daysToComplete < 1) return "Every stage takes at least one day.";
    if (p.dailyRateMinor < 0 || p.amountMinor < 0) return "A price cannot be negative.";
  }
  for (let i = 1; i < byStage.length; i++) {
    const before = byStage[i - 1]!;
    const after = byStage[i]!;
    if (after.startDate <= endOfStage(before)) {
      const a = serviceLabelOf(after.service).toLowerCase();
      const b = serviceLabelOf(before.service).toLowerCase();
      return `${serviceLabelOf(after.service)} cannot start before ${b} is finished. ` +
        `Give ${a} a later start date.`;
    }
  }
  return null;
}

/** The whole package's span: the first stage's start to the last stage's end. */
export function spanOf(plan: readonly PlannedOperation[]): { startDate: string; endDate: string } {
  const sorted = [...plan].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const first = sorted[0]!;
  const last = [...plan].sort((a, b) => endOfStage(a).localeCompare(endOfStage(b))).at(-1)!;
  return { startDate: first.startDate, endDate: endOfStage(last) };
}

/** What the farmer owes the provider: the stages added up. The fee is added on top elsewhere. */
export const planTotal = (plan: readonly PlannedOperation[]) =>
  plan.reduce((sum, p) => sum + p.amountMinor, 0);

/**
 * A plan for a request nobody has planned yet: every stage, each one day, starting on the farmer's
 * preferred date and the day after the stage before. A starting point for the form to adjust, not
 * a schedule anybody should send unexamined.
 */
export function suggestPlan(ops: readonly Operation[], preferredDate: string): PlannedOperation[] {
  let day = preferredDate;
  return [...ops].sort((a, b) => a.sequence - b.sequence).map((o) => {
    const p: PlannedOperation = {
      operationId: o.id, service: o.service, sequence: o.sequence,
      startDate: day, daysToComplete: 1, dailyRateMinor: 0, amountMinor: 0,
    };
    day = addDays(day, 2); // a day to work, a day between: changeable, and usually changed
    return p;
  });
}

/** Sorts by the farming year rather than by name, for any screen showing a list of services. */
export const byFieldOrder = (a: { service: string }, b: { service: string }) =>
  orderOf(a.service) - orderOf(b.service);
