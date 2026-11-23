import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { audit } from "./business";

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
 * Three rules it exists to keep:
 *
 *  - **All or nothing.** "If any resource conflicts, send nothing and leave no partial holds."
 *    Every hold for one quote is written in a single transaction that also does the clash check,
 *    so two providers racing for the same plough cannot both win and no half-held set survives.
 *  - **One physical thing is one thing.** "One physical plough linked to two tractors is still one
 *    plough." A hold is on a resource id, so the same machine named from two quotes collides
 *    whatever it is attached to. Operators collide the same way.
 *  - **Expiry does not need anybody watching.** "Expiry runs without an open page." A hold carries
 *    its own expiry instant; `expired()` reads the clock, so a lapsed hold stops blocking the
 *    moment it lapses rather than when a sweep next runs. The sweep only tidies the row and
 *    releases what the records still show as held.
 */

export type HoldKind = "equipment" | "operator";
export type HoldStatus = "held" | "released" | "converted";

export type Hold = {
  id: string; quoteId: string; requestId: string; businessId: string;
  kind: HoldKind; resourceId: string; startDate: string; endDate: string;
  status: HoldStatus; expiresAt: string; createdAt: string;
};

type Row = {
  id: string; quote_id: string; request_id: string; business_id: string;
  kind: HoldKind; resource_id: string; start_date: string; end_date: string;
  status: HoldStatus; expires_at: string; created_at: string;
};

const fromRow = (r: Row): Hold => ({
  id: r.id, quoteId: r.quote_id, requestId: r.request_id, businessId: r.business_id,
  kind: r.kind, resourceId: r.resource_id, startDate: r.start_date, endDate: r.end_date,
  status: r.status, expiresAt: r.expires_at, createdAt: r.created_at,
});

/** A hold past its moment blocks nothing, whether or not the sweep has been round yet. */
export const expired = (h: Pick<Hold, "status" | "expiresAt">) =>
  h.status === "held" && h.expiresAt !== "" && Date.now() > Date.parse(h.expiresAt);

export type Requested = { kind: HoldKind; resourceId: string; label: string };

export type Clash = {
  kind: HoldKind; resourceId: string; label: string;
  /** What it is already spoken for by, in words a provider can act on. */
  why: string;
};

/**
 * Who else is holding these resources over this window.
 *
 * Both kinds of commitment count: a live hold from somebody else's sent quote, and an accepted
 * job that already owns the dates. Expired holds are excluded here rather than relying on the
 * sweep, so a provider is never blocked by a quote that has already lapsed.
 */
export async function clashesFor(
  requested: readonly Requested[], startDate: string, endDate: string,
  exceptQuoteId: string | null, t: Queries = db,
): Promise<Clash[]> {
  const now = new Date().toISOString();
  const out: Clash[] = [];

  for (const r of requested) {
    // Another sent quote still holding it.
    const held = await t.get(`SELECT h.quote_id, q.request_id, sr.reference, h.start_date, h.end_date
         FROM resource_hold h
         JOIN quote q ON q.id = h.quote_id
         JOIN service_request sr ON sr.id = h.request_id
         WHERE h.kind=? AND h.resource_id=? AND h.status='held'
           AND h.quote_id <> COALESCE(?, '')
           AND h.expires_at > ?
           AND h.start_date <= ? AND h.end_date >= ?
         LIMIT 1`, r.kind, r.resourceId, exceptQuoteId, now, endDate, startDate) as
      { reference: string; start_date: string; end_date: string } | undefined;
    if (held) {
      out.push({ ...r, why: `held by your quote on ${held.reference} from ${held.start_date} to ${held.end_date}` });
      continue;
    }

    // An accepted job that owns the dates. Machines sit in job_asset; operators on the job itself.
    const committed = r.kind === "equipment"
      ? await t.get(`SELECT sr.reference, j.start_date, j.end_date
             FROM job_asset a JOIN job j ON j.id = a.job_id JOIN service_request sr ON sr.id = j.request_id
             WHERE a.equipment_id=? AND j.status IN ('scheduled','in_progress','work_reported')
               AND j.start_date <= ? AND j.end_date >= ? LIMIT 1`, r.resourceId, endDate, startDate)
      : await t.get(`SELECT sr.reference, j.start_date, j.end_date
             FROM job j JOIN service_request sr ON sr.id = j.request_id
             WHERE j.operator_id=? AND j.status IN ('scheduled','in_progress','work_reported')
               AND j.start_date <= ? AND j.end_date >= ? LIMIT 1`, r.resourceId, endDate, startDate);
    const c = committed as { reference: string; start_date: string; end_date: string } | undefined;
    if (c) {
      out.push({ ...r, why: `committed to ${c.reference} from ${c.start_date} to ${c.end_date}` });
      continue;
    }

    // Recorded leave keeps an operator off a job as surely as another job does.
    if (r.kind === "operator") {
      const away = await t.get(`SELECT away_from, away_to FROM team_member WHERE id=?`, r.resourceId) as
        { away_from: string | null; away_to: string | null } | undefined;
      if (away?.away_from && away.away_to && away.away_from <= endDate && away.away_to >= startDate) {
        out.push({ ...r, why: `away from ${away.away_from} to ${away.away_to}` });
      }
    }
  }
  return out;
}

export type PlaceResult = { ok: true; holds: Hold[] } | { ok: false; clashes: Clash[] };

/**
 * Holds the complete set for one quote, or nothing at all.
 *
 * The check and the writes are one transaction, which is the whole point: "reserve the complete
 * resource set in one server-side operation… recheck even if the screen previously showed
 * availability". Anything this business already held for the same quote is released first, so
 * replacing a quote moves its holds rather than stacking a second set on top.
 */
export async function place(
  quoteId: string, requestId: string, businessId: string,
  requested: readonly Requested[], startDate: string, endDate: string, expiresAt: string,
  t: Queries,
): Promise<PlaceResult> {
  await t.run(`UPDATE resource_hold SET status='released', released_at=?, release_reason='Quote replaced'
       WHERE quote_id=? AND status='held'`, new Date().toISOString(), quoteId);

  const clashes = await clashesFor(requested, startDate, endDate, quoteId, t);
  // Nothing has been written that matters yet, so returning here leaves no partial set.
  if (clashes.length) return { ok: false, clashes };

  const now = new Date().toISOString();
  const ids: string[] = [];
  for (const r of requested) {
    const id = randomUUID();
    ids.push(id);
    await t.run(`INSERT INTO resource_hold (id, quote_id, request_id, business_id, kind, resource_id,
         start_date, end_date, status, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,'held',?,?)`,
      id, quoteId, requestId, businessId, r.kind, r.resourceId, startDate, endDate, expiresAt, now);
  }
  const rows = await t.all(`SELECT * FROM resource_hold WHERE quote_id=? AND status='held'`, quoteId) as Row[];
  return { ok: true, holds: rows.filter((r) => ids.includes(r.id)).map(fromRow) };
}

/** Everything one quote is holding, lapsed ones included so a screen can say why it lapsed. */
export async function forQuote(quoteId: string, t: Queries = db): Promise<Hold[]> {
  const rows = await t.all("SELECT * FROM resource_hold WHERE quote_id=? ORDER BY kind, created_at", quoteId) as Row[];
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

/** Audit helper so every caller writes the same wording. */
export const logHold = (actorId: string, action: string, quoteId: string, detail?: string) =>
  audit(actorId, `hold.${action}`, quoteId, detail);
