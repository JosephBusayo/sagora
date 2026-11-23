import "server-only";
import { db } from "./db";
import { audit } from "./business";
import { missingDetails } from "./land";
import { serviceLabel } from "./requests";
import { RESPONSE_HOURS } from "./quotes";

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
  // There was an "answer_days" threshold here. It is gone rather than left on the settings screen
  // doing nothing: a quote now lapses after a fixed 48 hours (src/lib/quotes.ts), so how long to
  // wait before chasing one is no longer a setting anybody can meaningfully change.
  { key: "upcoming_days", label: "Show jobs starting within (days)", fallback: 7 },
  // Open brief question (§10.4): "Hold / quote / payment expiry rules". Until Karim sets one,
  // held money is overdue after the same 2 days as the other queues here — a sensible default,
  // changeable on this screen like every other threshold, not a separate decision to wire in later.
  { key: "hold_days", label: "Money held but not yet booked is overdue after (days)", fallback: 2 },
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

/**
 * Somebody a coordinator may need to ring about an item (Karim, 23 Nov 2026). Every queue carries
 * these, because the point of a queue is that somebody chases it, and chasing happens on the
 * phone: a reference with no number behind it means opening three more screens to find one.
 */
export type Party = {
  /** "Farmer", "Provider", "Caller" — what this person is to the item, not their name. */
  role: string;
  name: string; phone: string; email: string;
  /** Said plainly where it changes how you make contact, eg a farmer with no account. */
  note?: string;
};

export type QueueItem = {
  key: string; reference: string; title: string; detail: string; href: string | null;
  /** When the thing last moved, as an ISO time. */
  since: string; overdue: boolean; followUp: FollowUp | null;
  /** Who to contact about this, farmer first. May be empty where there is nobody to ring. */
  parties: Party[];
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

  /* Contacts are looked up once into two maps rather than joined onto all nine queries. Nine
     joins would be nine chances to spell a column differently, and provider_business is small
     enough to read whole. Requests are bounded to the ones a queue can reach. */
  const bizRows = await db.all(`SELECT id, name, phone, email FROM provider_business`) as
    { id: string; name: string; phone: string; email: string }[];
  const providerOf = new Map(bizRows.map((b) => [b.id, {
    role: "Provider", name: b.name || "Unnamed business", phone: b.phone, email: b.email,
  } as Party]));

  const reqRows = await db.all(`SELECT id, contact_name, contact_phone, contact_email, farmer_id, assisted_by, caller_name, caller_relation
       FROM service_request WHERE status NOT IN ('cancelled','completed') LIMIT 2000`) as {
    id: string; contact_name: string; contact_phone: string; contact_email: string;
    farmer_id: string | null; assisted_by: string | null; caller_name: string | null; caller_relation: string | null;
  }[];
  const farmerOf = new Map<string, Party[]>();
  for (const r of reqRows) {
    const parties: Party[] = [{
      role: "Farmer", name: r.contact_name || "Not given", phone: r.contact_phone, email: r.contact_email,
      // How to reach them differs by how the request arrived, and that changes what you say.
      note: r.farmer_id ? "has an account" : r.assisted_by ? "no account — taken on a call" : "no account — sent from the website",
    }];
    // Somebody rang on the farmer's behalf: they are the number that will actually answer.
    if (r.caller_name) {
      parties.push({ role: "Caller", name: r.caller_name, phone: r.contact_phone, email: "", note: r.caller_relation ?? "" });
    }
    farmerOf.set(r.id, parties);
  }

  /** Farmer (and caller) for a request, then the provider, in the order you would ring them. */
  const both = (requestId: string | null, businessId: string | null): Party[] => [
    ...(requestId ? farmerOf.get(requestId) ?? [] : []),
    ...(businessId ? [providerOf.get(businessId)].filter((p): p is Party => Boolean(p)) : []),
  ];

  const item = (i: Omit<QueueItem, "followUp" | "overdue" | "parties"> & { overdue?: boolean; parties?: Party[] }): QueueItem => {
    const f = fu.get(i.key) ?? null;
    // A follow-up whose due date has passed is overdue whatever the threshold says.
    const late = Boolean(f?.dueOn && f.dueOn < isoDay());
    return { ...i, overdue: Boolean(i.overdue) || late, followUp: f, parties: i.parties ?? [] };
  };

  const review = await db.all(`SELECT id, name, district, submitted_at, phone, email FROM provider_business WHERE status='submitted' ORDER BY submitted_at ASC`) as
    { id: string; name: string; district: string; submitted_at: string; phone: string; email: string }[];

  const unquoted = await db.all(`SELECT id, reference, service, district, created_at, assisted_by FROM service_request
       WHERE status='awaiting_quotes' AND private_to IS NULL AND created_at < ? ORDER BY created_at ASC LIMIT 200`, daysAgo(t.quote_days)) as
    { id: string; reference: string; service: string; district: string; created_at: string; assisted_by: string | null }[];

  const open = await db.all(`SELECT * FROM service_request WHERE status IN ('awaiting_quotes','quotes_sent') AND private_to IS NULL
       ORDER BY created_at ASC LIMIT 500`) as Record<string, string | null>[];
  const missing = open.map((r) => ({ r, gaps: missingDetails({
    service: r.service ?? "", landType: r.land_type ?? "", cropVariety: r.crop_variety ?? "", plantedOn: r.planted_on ?? "", cropReadiness: r.crop_readiness ?? "",
  }) })).filter((x) => x.gaps.length);

  const inspections = await db.all(`SELECT i.request_id, i.status, i.scheduled_for, i.proposed_for, i.updated_at, r.reference, r.assisted_by, b.name AS business, b.id AS business_id
       FROM inspection i JOIN service_request r ON r.id = i.request_id JOIN provider_business b ON b.id = i.business_id
       WHERE i.status IN ('required','scheduled') ORDER BY i.updated_at ASC`) as
    { request_id: string; status: string; scheduled_for: string; proposed_for: string | null; updated_at: string; reference: string; assisted_by: string | null; business: string; business_id: string }[];

  // Quotes still inside their 48 hours but running out, so a coordinator can ring the farmer
  // while there is still something to accept. The old answer_days threshold outlived its rule: it
  // waited three days to flag a quote that now dies after 48 hours, so by the time anything showed
  // up here it was already dead. The window itself is the deadline; this looks at what is left.
  const closingSoon = new Date(Date.now() - (RESPONSE_HOURS - 12) * 3600_000).toISOString();
  const lapsedAt = new Date(Date.now() - RESPONSE_HOURS * 3600_000).toISOString();
  const unanswered = await db.all(`SELECT q.id, q.created_at, q.valid_until, r.id AS request_id, r.reference, r.assisted_by, b.name AS business, b.id AS business_id
       FROM quote q JOIN service_request r ON r.id = q.request_id JOIN provider_business b ON b.id = q.business_id
       WHERE q.status='sent' AND q.created_at < ? AND q.created_at > ? AND r.status <> 'cancelled' ORDER BY q.created_at ASC`, closingSoon, lapsedAt) as
    { id: string; created_at: string; valid_until: string; request_id: string; reference: string; assisted_by: string | null; business: string; business_id: string }[];

  const upcoming = await db.all(`SELECT j.id, j.start_date, j.ready_at, j.mobilised_at, j.updated_at, r.id AS request_id, r.reference, r.assisted_by, b.name AS business, b.id AS business_id
       FROM job j JOIN service_request r ON r.id = j.request_id JOIN provider_business b ON b.id = j.business_id
       WHERE j.status='scheduled' AND j.start_date >= ? AND j.start_date <= ? ORDER BY j.start_date ASC`, isoDay(-1), isoDay(t.upcoming_days)) as
    { id: string; start_date: string; ready_at: string | null; mobilised_at: string | null; updated_at: string; request_id: string; reference: string; assisted_by: string | null; business: string; business_id: string }[];

  // The job is joined only to find the provider to ring. A case can exist before there is a job,
  // so it is a LEFT JOIN: a money exception must still be listed with nobody assigned to the work.
  const cases = await db.all(`SELECT c.id, c.kind, c.detail, c.opened_at, r.id AS request_id, r.reference, r.assisted_by, j.business_id
       FROM exception_case c JOIN service_request r ON r.id = c.request_id LEFT JOIN job j ON j.request_id = r.id
       WHERE c.status='open' ORDER BY c.opened_at ASC`) as
    { id: string; kind: string; detail: string; opened_at: string; request_id: string; reference: string; assisted_by: string | null; business_id: string | null }[];

  const disputed = await db.all(`SELECT j.id, j.concern, j.updated_at, j.business_id, r.id AS request_id, r.reference, r.assisted_by FROM job j
       JOIN service_request r ON r.id = j.request_id WHERE j.status='disputed' ORDER BY j.updated_at ASC`) as
    { id: string; concern: string; updated_at: string; business_id: string; request_id: string; reference: string; assisted_by: string | null }[];

  // UC03: an approved provider asking to work somewhere new waits for the same review.
  const areas = await (await import("./coverage")).pendingChanges();

  const failed = await db.all(`SELECT id, kind, subject, created_at FROM notification_outbox WHERE status='failed' ORDER BY created_at DESC LIMIT 100`) as
    { id: string; kind: string; subject: string; created_at: string }[];

  return [
    {
      id: "review", title: "Provider reviews", body: "Applications waiting for a decision.",
      items: review.map((b) => item({
        key: `review:${b.id}`, reference: b.name, title: "Waiting for review", detail: b.district || "No district yet",
        href: "/staff/providers", since: b.submitted_at, overdue: b.submitted_at < daysAgo(t.review_days),
        parties: [{ role: "Provider", name: b.name || "Unnamed business", phone: b.phone, email: b.email }],
      })).concat(areas.map((c) => item({
        key: `areas:${c.businessId}`, reference: c.name, title: "New districts to check",
        detail: c.areas.map((a) => `${a.district} ${serviceLabel(a.service).toLowerCase()}`).join(", "),
        href: "/staff/providers", since: c.requestedAt, overdue: c.requestedAt < daysAgo(t.review_days),
        parties: [providerOf.get(c.businessId) ?? { role: "Provider", name: c.name, phone: "", email: c.email }],
      }))),
    },
    {
      id: "unquoted", title: "No quote yet", body: `Requests no provider has quoted after ${t.quote_days} days.`,
      items: unquoted.map((r) => item({
        key: `unquoted:${r.id}`, reference: r.reference, title: `${serviceLabel(r.service)} in ${r.district}`, detail: "No provider has quoted",
        href: requestHref(r), since: r.created_at, overdue: true,
        parties: both(r.id, null),
      })),
    },
    {
      id: "missing", title: "Missing request details", body: "Details the farmer could not give, to find out before pricing.",
      items: missing.map(({ r, gaps }) => item({
        key: `missing:${r.id}`, reference: r.reference ?? "", title: serviceLabel(r.service ?? ""), detail: `Not known: ${gaps.join(", ")}`,
        href: requestHref({ id: r.id ?? "", assisted_by: r.assisted_by ?? null }), since: r.updated_at ?? r.created_at ?? now,
        parties: both(r.id ?? null, null),
      })),
    },
    {
      id: "inspections", title: "Inspections", body: "Farms a provider needs to see before pricing.",
      items: inspections.map((i) => item({
        key: `inspection:${i.request_id}:${i.business}`, reference: i.reference, title: i.business,
        detail: i.status === "scheduled" ? `Booked for ${i.scheduled_for}`
          : i.proposed_for ? `Farmer suggested ${i.proposed_for}, provider has not confirmed`
            : "Needed, no day agreed yet",
        // Farm inspections, not the assisted-request page: that one 404s for a farmer who has an
        // account, and this queue is mostly those. The new page carries both sides' numbers.
        href: "/staff/inspections", since: i.updated_at,
        // A day that has already passed, or a farmer's suggestion nobody has answered.
        overdue: (i.status === "scheduled" && i.scheduled_for < isoDay())
          || (i.status === "required" && Boolean(i.proposed_for) && i.updated_at < daysAgo(1)),
        parties: both(i.request_id, i.business_id),
      })),
    },
    {
      id: "unanswered", title: "Quotes about to lapse",
      body: `Quotes with less than 12 hours left of their ${RESPONSE_HOURS}-hour window. Ring the farmer before they expire.`,
      items: unanswered.map((q) => item({
        key: `unanswered:${q.id}`, reference: q.reference, title: q.business,
        detail: `Expires ${new Date(Date.parse(q.created_at) + RESPONSE_HOURS * 3600_000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}`,
        href: requestHref({ id: q.request_id, assisted_by: q.assisted_by }), since: q.created_at, overdue: true,
        parties: both(q.request_id, q.business_id),
      })),
    },
    {
      id: "upcoming", title: "Upcoming jobs", body: `Jobs starting within ${t.upcoming_days} days.`,
      items: upcoming.map((j) => item({
        key: `upcoming:${j.id}`, reference: j.reference, title: j.business,
        detail: `Starts ${j.start_date}. ${j.mobilised_at ? "Equipment on the way." : j.ready_at ? "Ready for dispatch." : "Not ready for dispatch."}`,
        href: requestHref({ id: j.request_id, assisted_by: j.assisted_by }), since: j.updated_at,
        overdue: !j.ready_at && j.start_date <= isoDay(1),
        parties: both(j.request_id, j.business_id),
      })),
    },
    {
      id: "delays", title: "Delays, faults and concerns", body: "Work stopped by a breakdown, and farmers who raised a concern.",
      items: [
        ...cases.filter((c) => c.kind === "no_replacement").map((c) => item({
          key: `case:${c.id}`, reference: c.reference, title: "No replacement equipment", detail: c.detail,
          href: "/staff/payments?tab=cases", since: c.opened_at, overdue: true,
          parties: both(c.request_id, c.business_id),
        })),
        ...disputed.map((j) => item({
          key: `dispute:${j.id}`, reference: j.reference, title: "Farmer raised a concern", detail: j.concern,
          href: "/staff/payments?tab=disputes", since: j.updated_at, overdue: true,
          parties: both(j.request_id, j.business_id),
        })),
      ],
    },
    {
      id: "payments", title: "Payment exceptions", body: `Money that arrived where it could not simply be booked, overdue after ${t.hold_days} days.`,
      items: cases.filter((c) => c.kind !== "no_replacement").map((c) => item({
        key: `case:${c.id}`, reference: c.reference, title: c.kind.replace(/_/g, " "), detail: c.detail,
        href: "/staff/payments?tab=cases", since: c.opened_at, overdue: c.opened_at < daysAgo(t.hold_days),
        parties: both(c.request_id, c.business_id),
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
