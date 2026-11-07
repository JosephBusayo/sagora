import "server-only";
import { db } from "./db";
import { audit } from "./business";
import { missingDetails } from "./land";
import { serviceLabel } from "./requests";

/**
 * The coordinator's queues (UC14). Each queue is worked out from the records themselves, so
 * nothing has to remember to add an item: a request with no quote after two days is in the
 * "No quote yet" queue because that is what the data says. A follow-up only adds who owns it,
 * the next action and when it is due.
 */

/* ---------------------------------------------------------------- settings */

export const THRESHOLDS = [
  { key: "review_days", label: "A provider review is overdue after (days)", fallback: 2 },
  { key: "quote_days", label: "A request with no quote is overdue after (days)", fallback: 2 },
  { key: "answer_days", label: "A quote the farmer has not answered is overdue after (days)", fallback: 3 },
  { key: "upcoming_days", label: "Show jobs starting within (days)", fallback: 7 },
] as const;

export type ThresholdKey = (typeof THRESHOLDS)[number]["key"];

export async function getSetting(key: string): Promise<string | null> {
  const r = await db.get("SELECT value FROM app_setting WHERE key=?", key) as { value: string } | undefined;
  return r?.value ?? null;
}

export async function setSetting(staffId: string, key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await db.run(`INSERT INTO app_setting (key, value, updated_by, updated_at) VALUES (?,?,?,?)
       ON CONFLICT (key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`, key, value, staffId, now);
  await audit(staffId, "setting.changed", key, value);
}

export async function thresholds(): Promise<Record<ThresholdKey, number>> {
  const out = {} as Record<ThresholdKey, number>;
  for (const t of THRESHOLDS) {
    const n = Number(await getSetting(t.key));
    out[t.key] = Number.isFinite(n) && n > 0 ? Math.min(365, Math.floor(n)) : t.fallback;
  }
  return out;
}

/* ------------------------------------------------------------------ queues */

export type FollowUp = { ownerId: string | null; nextAction: string; dueOn: string; note: string; updatedAt: string };

export type QueueItem = {
  key: string; reference: string; title: string; detail: string; href: string | null;
  /** When the thing last moved, as an ISO time. */
  since: string; overdue: boolean; followUp: FollowUp | null;
};

export type Queue = { id: string; title: string; body: string; items: QueueItem[] };

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const isoDay = (offset = 0) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

async function followUps(): Promise<Map<string, FollowUp>> {
  const rows = await db.all("SELECT * FROM follow_up") as { item_key: string; owner_id: string | null; next_action: string; due_on: string; note: string; updated_at: string }[];
  return new Map(rows.map((r) => [r.item_key, { ownerId: r.owner_id, nextAction: r.next_action, dueOn: r.due_on, note: r.note, updatedAt: r.updated_at }]));
}

const requestHref = (r: { id: string; assisted_by: string | null }) => (r.assisted_by ? `/staff/requests/${r.id}` : null);

export async function queues(): Promise<Queue[]> {
  const t = await thresholds();
  const fu = await followUps();
  const now = new Date().toISOString();
  const item = (i: Omit<QueueItem, "followUp" | "overdue"> & { overdue?: boolean }): QueueItem => {
    const f = fu.get(i.key) ?? null;
    // A follow-up whose due date has passed is overdue whatever the threshold says.
    const late = Boolean(f?.dueOn && f.dueOn < isoDay());
    return { ...i, overdue: Boolean(i.overdue) || late, followUp: f };
  };

  const review = await db.all(`SELECT id, name, district, submitted_at FROM provider_business WHERE status='submitted' ORDER BY submitted_at ASC`) as
    { id: string; name: string; district: string; submitted_at: string }[];

  const unquoted = await db.all(`SELECT id, reference, service, district, created_at, assisted_by FROM service_request
       WHERE status='awaiting_quotes' AND private_to IS NULL AND created_at < ? ORDER BY created_at ASC LIMIT 200`, daysAgo(t.quote_days)) as
    { id: string; reference: string; service: string; district: string; created_at: string; assisted_by: string | null }[];

  const open = await db.all(`SELECT * FROM service_request WHERE status IN ('awaiting_quotes','quotes_sent') AND private_to IS NULL
       ORDER BY created_at ASC LIMIT 500`) as Record<string, string | null>[];
  const missing = open.map((r) => ({ r, gaps: missingDetails({
    service: r.service ?? "", landType: r.land_type ?? "", cropVariety: r.crop_variety ?? "", plantedOn: r.planted_on ?? "", cropReadiness: r.crop_readiness ?? "",
  }) })).filter((x) => x.gaps.length);

  const inspections = await db.all(`SELECT i.request_id, i.status, i.scheduled_for, i.updated_at, r.reference, r.assisted_by, b.name AS business
       FROM inspection i JOIN service_request r ON r.id = i.request_id JOIN provider_business b ON b.id = i.business_id
       WHERE i.status IN ('required','scheduled') ORDER BY i.updated_at ASC`) as
    { request_id: string; status: string; scheduled_for: string; updated_at: string; reference: string; assisted_by: string | null; business: string }[];

  const unanswered = await db.all(`SELECT q.id, q.created_at, q.valid_until, r.id AS request_id, r.reference, r.assisted_by, b.name AS business
       FROM quote q JOIN service_request r ON r.id = q.request_id JOIN provider_business b ON b.id = q.business_id
       WHERE q.status='sent' AND q.valid_until >= ? AND q.created_at < ? AND r.status <> 'cancelled' ORDER BY q.created_at ASC`, isoDay(), daysAgo(t.answer_days)) as
    { id: string; created_at: string; valid_until: string; request_id: string; reference: string; assisted_by: string | null; business: string }[];

  const upcoming = await db.all(`SELECT j.id, j.start_date, j.ready_at, j.mobilised_at, j.updated_at, r.id AS request_id, r.reference, r.assisted_by, b.name AS business
       FROM job j JOIN service_request r ON r.id = j.request_id JOIN provider_business b ON b.id = j.business_id
       WHERE j.status='scheduled' AND j.start_date >= ? AND j.start_date <= ? ORDER BY j.start_date ASC`, isoDay(-1), isoDay(t.upcoming_days)) as
    { id: string; start_date: string; ready_at: string | null; mobilised_at: string | null; updated_at: string; request_id: string; reference: string; assisted_by: string | null; business: string }[];

  const cases = await db.all(`SELECT c.id, c.kind, c.detail, c.opened_at, r.id AS request_id, r.reference, r.assisted_by
       FROM exception_case c JOIN service_request r ON r.id = c.request_id WHERE c.status='open' ORDER BY c.opened_at ASC`) as
    { id: string; kind: string; detail: string; opened_at: string; request_id: string; reference: string; assisted_by: string | null }[];

  const disputed = await db.all(`SELECT j.id, j.concern, j.updated_at, r.id AS request_id, r.reference, r.assisted_by FROM job j
       JOIN service_request r ON r.id = j.request_id WHERE j.status='disputed' ORDER BY j.updated_at ASC`) as
    { id: string; concern: string; updated_at: string; request_id: string; reference: string; assisted_by: string | null }[];

  const failed = await db.all(`SELECT id, kind, subject, created_at FROM notification_outbox WHERE status='failed' ORDER BY created_at DESC LIMIT 100`) as
    { id: string; kind: string; subject: string; created_at: string }[];

  return [
    {
      id: "review", title: "Provider reviews", body: "Applications waiting for a decision.",
      items: review.map((b) => item({
        key: `review:${b.id}`, reference: b.name, title: "Waiting for review", detail: b.district || "No district yet",
        href: "/staff/providers", since: b.submitted_at, overdue: b.submitted_at < daysAgo(t.review_days),
      })),
    },
    {
      id: "unquoted", title: "No quote yet", body: `Requests no provider has quoted after ${t.quote_days} days.`,
      items: unquoted.map((r) => item({
        key: `unquoted:${r.id}`, reference: r.reference, title: `${serviceLabel(r.service)} in ${r.district}`, detail: "No provider has quoted",
        href: requestHref(r), since: r.created_at, overdue: true,
      })),
    },
    {
      id: "missing", title: "Missing request details", body: "Details the farmer could not give, to find out before pricing.",
      items: missing.map(({ r, gaps }) => item({
        key: `missing:${r.id}`, reference: r.reference ?? "", title: serviceLabel(r.service ?? ""), detail: `Not known: ${gaps.join(", ")}`,
        href: requestHref({ id: r.id ?? "", assisted_by: r.assisted_by ?? null }), since: r.updated_at ?? r.created_at ?? now,
      })),
    },
    {
      id: "inspections", title: "Inspections", body: "Farms a provider needs to see before pricing.",
      items: inspections.map((i) => item({
        key: `inspection:${i.request_id}:${i.business}`, reference: i.reference, title: i.business,
        detail: i.status === "scheduled" ? `Booked for ${i.scheduled_for}` : "Needed, not booked yet",
        href: requestHref({ id: i.request_id, assisted_by: i.assisted_by }), since: i.updated_at,
        overdue: i.status === "scheduled" && i.scheduled_for < isoDay(),
      })),
    },
    {
      id: "unanswered", title: "Unanswered quotes", body: `Quotes the farmer has not answered after ${t.answer_days} days.`,
      items: unanswered.map((q) => item({
        key: `unanswered:${q.id}`, reference: q.reference, title: q.business, detail: `Price holds until ${q.valid_until}`,
        href: requestHref({ id: q.request_id, assisted_by: q.assisted_by }), since: q.created_at, overdue: true,
      })),
    },
    {
      id: "upcoming", title: "Upcoming jobs", body: `Jobs starting within ${t.upcoming_days} days.`,
      items: upcoming.map((j) => item({
        key: `upcoming:${j.id}`, reference: j.reference, title: j.business,
        detail: `Starts ${j.start_date}. ${j.mobilised_at ? "Equipment on the way." : j.ready_at ? "Ready for dispatch." : "Not ready for dispatch."}`,
        href: requestHref({ id: j.request_id, assisted_by: j.assisted_by }), since: j.updated_at,
        overdue: !j.ready_at && j.start_date <= isoDay(1),
      })),
    },
    {
      id: "delays", title: "Delays, faults and concerns", body: "Work stopped by a breakdown, and farmers who raised a concern.",
      items: [
        ...cases.filter((c) => c.kind === "no_replacement").map((c) => item({
          key: `case:${c.id}`, reference: c.reference, title: "No replacement equipment", detail: c.detail,
          href: "/staff/payments?tab=cases", since: c.opened_at, overdue: true,
        })),
        ...disputed.map((j) => item({
          key: `dispute:${j.id}`, reference: j.reference, title: "Farmer raised a concern", detail: j.concern,
          href: "/staff/payments?tab=disputes", since: j.updated_at, overdue: true,
        })),
      ],
    },
    {
      id: "payments", title: "Payment exceptions", body: "Money that arrived where it could not simply be booked.",
      items: cases.filter((c) => c.kind !== "no_replacement").map((c) => item({
        key: `case:${c.id}`, reference: c.reference, title: c.kind.replace(/_/g, " "), detail: c.detail,
        href: "/staff/payments?tab=cases", since: c.opened_at, overdue: true,
      })),
    },
    {
      id: "emails", title: "Emails that gave up", body: "Messages that could not be sent after every retry.",
      items: failed.map((m) => item({
        key: `email:${m.id}`, reference: m.kind, title: m.subject, detail: "Not delivered",
        href: "/staff/outbox", since: m.created_at, overdue: true,
      })),
    },
  ];
}

export type FollowUpInput = { ownerId: string | null; nextAction: string; dueOn: string; note: string };

/** Records who owns an item and what happens next. Changes nothing about the item itself. */
export async function saveFollowUp(staffId: string, key: string, input: FollowUpInput): Promise<void> {
  const now = new Date().toISOString();
  await db.run(`INSERT INTO follow_up (item_key, owner_id, next_action, due_on, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (item_key) DO UPDATE SET owner_id=excluded.owner_id, next_action=excluded.next_action, due_on=excluded.due_on,
         note=excluded.note, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    key, input.ownerId, input.nextAction, input.dueOn, input.note, staffId, now);
  await audit(staffId, "follow_up.saved", key, [input.nextAction, input.dueOn].filter(Boolean).join(" by "));
}
