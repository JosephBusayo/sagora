import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { audit } from "./business";
import { getSetting } from "./follow-ups";

/**
 * Capacity held by a sent quote (Karim's handover, 23 November 2026).
 *
 * The rule the handover opens with: "A provider cannot send a quotation without available capacity
 * for the proposed work. The system must identify and reserve the actual working machine, required
 * compatible implements and a suitable provider operator for the full period." So sending a quote
 * reserves things, and this file is that reservation.
 *
 * This replaces the arrangement agreed on the 22 November call, where naming equipment on a quote
 * committed nothing and the lock landed on acceptance. The handover is the later word and says to
 * hold at send; where the two differ, the handover wins.
 *
 * Five rules it exists to keep:
 *
 *  - **All or nothing.** "If any resource conflicts, send nothing and leave no partial holds."
 *    Every hold for one quote is written in a single transaction that also does the clash check,
 *    so two providers racing for the same plough cannot both win and no half-held set survives.
 *  - **One physical thing is one thing.** "One physical plough linked to two tractors is still one
 *    plough." A hold is on a resource id, so the same machine named from two quotes collides
 *    whatever it is attached to — and, since the shares of 28 November, whichever business named
 *    it. Operators collide the same way.
 *  - **Expiry does not need anybody watching.** "Expiry runs without an open page." A hold carries
 *    its own expiry instant; `expired()` reads the clock, so a lapsed hold stops blocking the
 *    moment it lapses rather than when a sweep next runs. The sweep only tidies the row and
 *    releases what the records still show as held.
 *  - **Getting there costs days.** "Account for travel and set-up time so the days either side of
 *    the work are not offered as free." A hold therefore covers two windows: the days the work
 *    happens, and the wider span the machine is genuinely unavailable for. Clashes are decided on
 *    the wider one. See `blockWindow`.
 *  - **A refusal names the way out.** "Each case blocks Send quotation with a specific reason",
 *    and a specific reason that leaves a provider nowhere to go is only half of one — so
 *    `nextFreeWindow` works out the earliest dates that would succeed.
 */

export type HoldKind = "equipment" | "operator";
export type HoldStatus = "held" | "released" | "converted";

export type Hold = {
  id: string; quoteId: string; requestId: string; businessId: string;
  kind: HoldKind; resourceId: string; startDate: string; endDate: string;
  status: HoldStatus; expiresAt: string; createdAt: string;
  /** The wider span including travel and set-up. Equal to the work dates on pre-028 rows. */
  blockFrom: string; blockTo: string;
  /** Which stage of the request this covers. Empty on single-service requests written before 028. */
  operationId: string;
};

type Row = {
  id: string; quote_id: string; request_id: string; business_id: string;
  kind: HoldKind; resource_id: string; start_date: string; end_date: string;
  status: HoldStatus; expires_at: string; created_at: string;
  block_from?: string | null; block_to?: string | null; operation_id?: string | null;
};

const fromRow = (r: Row): Hold => ({
  id: r.id, quoteId: r.quote_id, requestId: r.request_id, businessId: r.business_id,
  kind: r.kind, resourceId: r.resource_id, startDate: r.start_date, endDate: r.end_date,
  status: r.status, expiresAt: r.expires_at, createdAt: r.created_at,
  blockFrom: r.block_from || r.start_date, blockTo: r.block_to || r.end_date,
  operationId: r.operation_id ?? "",
});

/** A hold past its moment blocks nothing, whether or not the sweep has been round yet. */
export const expired = (h: Pick<Hold, "status" | "expiresAt">) =>
  h.status === "held" && h.expiresAt !== "" && Date.now() > Date.parse(h.expiresAt);

/* ------------------------------------------------------------- travel and set-up */

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/**
 * The default days either side of a job for getting there, setting up and getting back.
 *
 * One day. Sierra Leone's districts are large, the roads in them are what they are, and a tractor
 * moving between two farms in Bombali is not available for either on the day it travels. Karim has
 * not given a number, so this is a changeable default stored as a setting and written into
 * WAITING-ON.md rather than fixed in code.
 */
export const DEFAULT_TRAVEL_DAYS = 1;

export async function travelDays(): Promise<number> {
  const raw = await getSetting("travel_setup_days");
  // Nothing stored is not the same as zero stored, and the difference matters here in a way it does
  // not for the other settings: zero is a legitimate answer ("no travel allowance"), so an unset
  // key cannot be allowed to fall through Number("") === 0 and silently switch the whole feature
  // off. Checked explicitly rather than relying on the range test below.
  if (raw === null || raw.trim() === "") return DEFAULT_TRAVEL_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 7 ? Math.floor(n) : DEFAULT_TRAVEL_DAYS;
}

export type Window = { from: string; to: string };

/** The work dates widened by travel each side. Both ends, because the machine has to come back. */
export const blockWindow = (startDate: string, endDate: string, travel: number): Window => ({
  from: addDays(startDate, -travel), to: addDays(endDate, travel),
});

/* ------------------------------------------------------------------- clashes */

export type Requested = { kind: HoldKind; resourceId: string; label: string };

export type Clash = {
  kind: HoldKind; resourceId: string; label: string;
  /** What it is already spoken for by, in words a provider can act on. */
  why: string;
  /** The span that is in the way, so a caller can suggest a date past it. */
  blockedTo: string;
  /** True when the commitment belongs to another business and had to be described without naming it. */
  elsewhere: boolean;
};

/**
 * How a clash reads when the thing in the way is somebody else's work.
 *
 * This is the privacy half of "a shared asset shares its reservation constraint without sharing
 * business data". A borrower who finds the machine busy has to be told the dates — otherwise they
 * cannot plan around it — and must not be told the reference, the farmer or the service, because
 * none of that is theirs. The dates are the constraint; the rest is the other business's.
 */
const redactFor = (own: boolean, reference: string, from: string, to: string): string =>
  own
    ? `committed to ${reference} from ${from} to ${to}`
    : `already committed by its owner from ${from} to ${to}`;

/**
 * What a question about availability is allowed to ignore.
 *
 * A quote being revised must not clash with its own holds, and a job being rescheduled must not
 * clash with itself. Before migration 029 these were two separate checks in two files, which is
 * how a reschedule onto dates another provider's quote was holding slipped through: the job-level
 * check only knew about other jobs. One check, one exemption, both kinds.
 */
export type Except = { quoteId?: string | null; jobId?: string | null };

/**
 * Who else is holding these resources over this window.
 *
 * Three kinds of commitment count: a live hold from somebody's sent quote, an accepted job that
 * already owns the dates, and recorded leave for an operator. Expired holds are excluded here
 * rather than relying on the sweep, so a provider is never blocked by a quote that has lapsed.
 *
 * `window` is the **padded** span — travel included — and so are the spans it is compared against.
 * That is what stops a machine being offered for the day it spends on the road.
 *
 * `askingBusinessId` decides how much a clash is allowed to say. When the blocking commitment
 * belongs to the asking business the reference is named; when it belongs to another business —
 * only possible on a shared asset — the dates are given and nothing else.
 */
export async function clashesFor(
  requested: readonly Requested[], window: Window,
  except: Except | string | null, askingBusinessId: string, t: Queries = db,
): Promise<Clash[]> {
  // A bare string is the old single-quote form, kept so the rule suites and the quote path read
  // the same as they did.
  const skip: Except = typeof except === "string" || except === null ? { quoteId: except } : except;
  const exceptQuoteId = skip.quoteId ?? null;
  const exceptJobId = skip.jobId ?? null;
  const now = new Date().toISOString();
  const out: Clash[] = [];

  for (const r of requested) {
    // Another sent quote still holding it. COALESCE on the block columns keeps pre-028 rows, whose
    // padded span was backfilled to the work dates, comparing correctly.
    const held = await t.get(`SELECT h.business_id, sr.reference,
           COALESCE(NULLIF(h.block_from,''), h.start_date) AS b_from,
           COALESCE(NULLIF(h.block_to,''), h.end_date) AS b_to
         FROM resource_hold h
         JOIN quote q ON q.id = h.quote_id
         JOIN service_request sr ON sr.id = h.request_id
         WHERE h.kind=? AND h.resource_id=? AND h.status='held'
           AND h.quote_id <> COALESCE(?, '')
           AND h.expires_at > ?
           AND COALESCE(NULLIF(h.block_from,''), h.start_date) <= ?
           AND COALESCE(NULLIF(h.block_to,''), h.end_date) >= ?
         LIMIT 1`, r.kind, r.resourceId, exceptQuoteId, now, window.to, window.from) as
      { business_id: string; reference: string; b_from: string; b_to: string } | undefined;
    if (held) {
      const own = held.business_id === askingBusinessId;
      out.push({
        ...r, blockedTo: held.b_to, elsewhere: !own,
        why: own
          ? `held by your quote on ${held.reference} from ${held.b_from} to ${held.b_to}`
          : `held by another quote from ${held.b_from} to ${held.b_to}`,
      });
      continue;
    }

    // An accepted job that owns the dates. Machines sit in job_asset; operators on the job itself.
    const committed = r.kind === "equipment"
      ? await t.get(`SELECT j.business_id, sr.reference,
               COALESCE(j.block_from, j.start_date) AS b_from, COALESCE(j.block_to, j.end_date) AS b_to
             FROM job_asset a JOIN job j ON j.id = a.job_id JOIN service_request sr ON sr.id = j.request_id
             WHERE a.equipment_id=? AND j.status IN ('scheduled','in_progress','work_reported')
               AND j.id <> COALESCE(?, '')
               AND COALESCE(j.block_from, j.start_date) <= ?
               AND COALESCE(j.block_to, j.end_date) >= ? LIMIT 1`, r.resourceId, exceptJobId, window.to, window.from)
      : await t.get(`SELECT j.business_id, sr.reference,
               COALESCE(j.block_from, j.start_date) AS b_from, COALESCE(j.block_to, j.end_date) AS b_to
             FROM job j JOIN service_request sr ON sr.id = j.request_id
             WHERE j.operator_id=? AND j.status IN ('scheduled','in_progress','work_reported')
               AND j.id <> COALESCE(?, '')
               AND COALESCE(j.block_from, j.start_date) <= ?
               AND COALESCE(j.block_to, j.end_date) >= ? LIMIT 1`, r.resourceId, exceptJobId, window.to, window.from);
    const c = committed as { business_id: string; reference: string; b_from: string; b_to: string } | undefined;
    if (c) {
      const own = c.business_id === askingBusinessId;
      out.push({ ...r, blockedTo: c.b_to, elsewhere: !own, why: redactFor(own, c.reference, c.b_from, c.b_to) });
      continue;
    }

    // Recorded leave keeps an operator off a job as surely as another job does. Travel is not added
    // to leave: a person on leave is away for exactly the days they said.
    if (r.kind === "operator") {
      const away = await t.get(`SELECT away_from, away_to FROM team_member WHERE id=?`, r.resourceId) as
        { away_from: string | null; away_to: string | null } | undefined;
      if (away?.away_from && away.away_to && away.away_from <= window.to && away.away_to >= window.from) {
        out.push({ ...r, blockedTo: away.away_to, elsewhere: false, why: `away from ${away.away_from} to ${away.away_to}` });
      }
    }
  }
  return out;
}

/**
 * The earliest start date on which this whole set would be free for this many days.
 *
 * "Show the next available window." A refusal that only says no leaves a provider clicking dates
 * until one takes, which is both slow and how double-bookings get attempted. This walks forward
 * from the day after whatever is in the way, in the same padded terms the clash check uses, and
 * gives up after a season rather than looping for ever.
 *
 * Deliberately not clever. It asks the same question the real check asks, which means it can never
 * suggest a window that the real check would then refuse — the failure mode that would make the
 * feature worse than nothing.
 */
export async function nextFreeWindow(
  requested: readonly Requested[], days: number, notBefore: string, askingBusinessId: string,
  travel?: number, t: Queries = db, except: Except | null = null,
): Promise<Window | null> {
  const pad = travel ?? (await travelDays());
  const span = Math.max(1, days) - 1;
  let start = notBefore;
  // A season's worth of days. Beyond that the answer is not a date, it is "buy another tractor".
  for (let tries = 0; tries < 120; tries++) {
    const work = { from: start, to: addDays(start, span) };
    const clashes = await clashesFor(requested, blockWindow(work.from, work.to, pad), except, askingBusinessId, t);
    if (clashes.length === 0) return work;
    // Jump past the latest thing in the way rather than trying tomorrow: it saves a hundred
    // queries on a busy machine and lands on the first day that could possibly be free.
    const furthest = clashes.map((c) => c.blockedTo).sort().at(-1)!;
    const next = addDays(furthest, pad + 1);
    start = next > start ? next : addDays(start, 1);
  }
  return null;
}

export type PlaceResult = { ok: true; holds: Hold[] } | { ok: false; clashes: Clash[] };

export type Placement = {
  /** The stage these resources are for. Empty for a single-service request. */
  operationId: string;
  startDate: string;
  endDate: string;
  requested: readonly Requested[];
};

/**
 * Holds the complete set for one quote, across every stage of it, or nothing at all.
 *
 * The check and the writes are one transaction, which is the whole point: "reserve the complete
 * resource set in one server-side operation… recheck even if the screen previously showed
 * availability". Anything this quote already held is released first, so replacing a quote moves its
 * holds rather than stacking a second set on top.
 *
 * A package is several placements here, one per operation, each with its own window — which is
 * exactly what "plan each operation and reserve its resources for its own window" asks for. They
 * succeed or fail together: a provider cannot end up holding a tractor for the ploughing of a
 * package whose planting they could not reserve.
 */
export async function place(
  quoteId: string, requestId: string, businessId: string,
  placements: readonly Placement[], expiresAt: string, travel: number, t: Queries,
): Promise<PlaceResult> {
  await t.run(`UPDATE resource_hold SET status='released', released_at=?, release_reason='Quote replaced'
       WHERE quote_id=? AND status='held'`, new Date().toISOString(), quoteId);

  // Every stage is checked before anything is written, so a conflict on the last stage cannot leave
  // the first one held.
  for (const p of placements) {
    const clashes = await clashesFor(
      p.requested, blockWindow(p.startDate, p.endDate, travel), quoteId, businessId, t);
    if (clashes.length) return { ok: false, clashes };
  }

  const now = new Date().toISOString();
  const ids: string[] = [];
  for (const p of placements) {
    const block = blockWindow(p.startDate, p.endDate, travel);
    for (const r of p.requested) {
      const id = randomUUID();
      ids.push(id);
      await t.run(`INSERT INTO resource_hold (id, quote_id, request_id, business_id, kind, resource_id,
           start_date, end_date, block_from, block_to, operation_id, status, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'held',?,?)`,
        id, quoteId, requestId, businessId, r.kind, r.resourceId, p.startDate, p.endDate,
        block.from, block.to, p.operationId, expiresAt, now);
    }
  }
  const rows = await t.all(`SELECT * FROM resource_hold WHERE quote_id=? AND status='held'`, quoteId) as Row[];
  return { ok: true, holds: rows.filter((r) => ids.includes(r.id)).map(fromRow) };
}

/** Everything one quote is holding, lapsed ones included so a screen can say why it lapsed. */
export async function forQuote(quoteId: string, t: Queries = db): Promise<Hold[]> {
  const rows = await t.all("SELECT * FROM resource_hold WHERE quote_id=? ORDER BY start_date, kind, created_at", quoteId) as Row[];
  return rows.map(fromRow);
}

/** Live holds on one request, across every provider who has quoted it. */
export async function forRequest(requestId: string, t: Queries = db): Promise<Hold[]> {
  const rows = await t.all(`SELECT * FROM resource_hold WHERE request_id=? AND status='held' AND expires_at > ?
       ORDER BY created_at`, requestId, new Date().toISOString()) as Row[];
  return rows.map(fromRow);
}

/** Lets go of what a quote was holding. Used by decline, withdrawal, expiry and losing out. */
export async function release(quoteId: string, reason: string, t: Queries = db): Promise<number> {
  const res = await t.run(`UPDATE resource_hold SET status='released', released_at=?, release_reason=?
       WHERE quote_id=? AND status='held'`, new Date().toISOString(), reason, quoteId);
  return res.changes;
}

/** Releases every quote on a request except the one that won. */
export async function releaseOthers(requestId: string, keepQuoteId: string, reason: string, t: Queries): Promise<number> {
  const res = await t.run(`UPDATE resource_hold SET status='released', released_at=?, release_reason=?
       WHERE request_id=? AND quote_id <> ? AND status='held'`,
    new Date().toISOString(), reason, requestId, keepQuoteId);
  return res.changes;
}

/**
 * Turns a quote's holds into the booking's own commitment.
 *
 * "Convert the same hold into the booking reservation under the deposit/full-payment rule. Do not
 * create a second reservation." Marking them converted rather than releasing them keeps the chain
 * readable: the dates a job owns are the dates its quote held.
 */
export async function convert(quoteId: string, t: Queries): Promise<number> {
  const res = await t.run(`UPDATE resource_hold SET status='converted', released_at=?
       WHERE quote_id=? AND status='held'`, new Date().toISOString(), quoteId);
  return res.changes;
}

/**
 * Releases holds whose moment has passed. Called by the nightly cron.
 *
 * Nothing depends on this running on time — `expired()` and the clash query both read the clock —
 * so a late sweep costs nothing but a stale-looking row.
 */
export async function sweepExpired(): Promise<{ quotes: number; holds: number }> {
  const now = new Date().toISOString();
  const stale = await db.all(`SELECT DISTINCT quote_id FROM resource_hold
       WHERE status='held' AND expires_at <> '' AND expires_at <= ?`, now) as { quote_id: string }[];
  let holds = 0;
  for (const s of stale) holds += await release(s.quote_id, "Quote expired without an answer");
  return { quotes: stale.length, holds };
}

/** For the provider's own screens: what this business is currently holding, and until when. */
export async function forBusiness(businessId: string): Promise<(Hold & { reference: string; label: string })[]> {
  const rows = await db.all(`SELECT h.*, sr.reference,
         COALESCE(e.name, tm.name, '') AS label
       FROM resource_hold h
       JOIN service_request sr ON sr.id = h.request_id
       LEFT JOIN equipment e ON e.id = h.resource_id AND h.kind = 'equipment'
       LEFT JOIN team_member tm ON tm.id = h.resource_id AND h.kind = 'operator'
       WHERE h.business_id=? AND h.status='held' AND h.expires_at > ?
       ORDER BY h.expires_at ASC`, businessId, new Date().toISOString()) as (Row & { reference: string; label: string })[];
  return rows.map((r) => ({ ...fromRow(r), reference: r.reference, label: r.label }));
}

/**
 * Moves the reservation behind a booking to new dates.
 *
 * "Reschedule and replacement swap reservations atomically; a failed change keeps the original"
 * (A08). The holds a quote placed became the booking's commitment when the farmer accepted, and a
 * reschedule has to move them rather than leave them pointing at the old week — otherwise the
 * records say one thing and the calendar says another, and whichever one a future clash check
 * reads, the other is wrong.
 *
 * Takes the caller's transaction, because the only safe place to do this is inside the one that is
 * already moving the job.
 */
export async function moveConverted(
  requestId: string, startDate: string, endDate: string, travel: number,
  resourceIds: readonly string[], t: Queries,
): Promise<number> {
  const block = blockWindow(startDate, endDate, travel);
  const now = new Date().toISOString();
  // Anything the job no longer uses is let go: a machine taken off a booking is free at once, which
  // is the "replacement" half of A08.
  if (resourceIds.length > 0) {
    const marks = resourceIds.map(() => "?").join(",");
    await t.run(`UPDATE resource_hold SET status='released', released_at=?,
           release_reason='Taken off the booking when it was rescheduled'
         WHERE request_id=? AND status='converted' AND resource_id NOT IN (${marks})`,
      now, requestId, ...resourceIds);
  }
  const res = await t.run(`UPDATE resource_hold SET start_date=?, end_date=?, block_from=?, block_to=?
       WHERE request_id=? AND status='converted'`,
    startDate, endDate, block.from, block.to, requestId);
  return res.changes;
}

/** Audit helper so every caller writes the same wording. */
export const logHold = (actorId: string, action: string, quoteId: string, detail?: string) =>
  audit(actorId, `hold.${action}`, quoteId, detail);
