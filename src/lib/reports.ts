import "server-only";
import { db } from "./db";

/**
 * The provider's Reports screen: what the business has quoted, won, done and been paid, all
 * counted from the records themselves. Nothing here is stored; every number is worked out on read.
 */

export type Report = {
  quotesSent: number;
  quotesWon: number;
  jobsDone: number;
  jobsOpen: number;
  acresDone: number;
  agreedMinor: number;
  paidOutMinor: number;
  byService: { service: string; jobs: number; acres: number; agreedMinor: number }[];
  byMachine: { id: string; name: string; kind: string; jobs: number; openFaults: number; status: string }[];
};

const n = (v: unknown) => Number(v ?? 0);

export async function reportFor(businessId: string): Promise<Report> {
  // One request counts once, however many versions of the quote were sent.
  const quotes = await db.get(`SELECT COUNT(DISTINCT request_id) AS sent,
         COUNT(DISTINCT CASE WHEN status='accepted' THEN request_id END) AS won
       FROM quote WHERE business_id=?`, businessId) as { sent: unknown; won: unknown };

  const jobs = await db.get(`SELECT
         SUM(CASE WHEN j.status='completed' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN j.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN j.status='completed' THEN COALESCE(j.reported_acres, r.acres) ELSE 0 END) AS acres
       FROM job j JOIN service_request r ON r.id = j.request_id WHERE j.business_id=?`, businessId) as { done: unknown; open: unknown; acres: unknown };

  const money = await db.get(`SELECT
         (SELECT COALESCE(SUM(a.amount_minor),0) FROM agreement a WHERE a.business_id=?) AS agreed,
         (SELECT COALESCE(SUM(x.net_minor),0) FROM release x JOIN agreement a ON a.request_id = x.request_id
            WHERE a.business_id=? AND x.kind='payout' AND x.status='paid') AS paid`, businessId, businessId) as { agreed: unknown; paid: unknown };

  const byService = await db.all(`SELECT r.service, COUNT(*) AS jobs,
         SUM(COALESCE(j.reported_acres, r.acres)) AS acres, SUM(a.amount_minor) AS agreed
       FROM agreement a JOIN service_request r ON r.id = a.request_id
       LEFT JOIN job j ON j.request_id = a.request_id
       WHERE a.business_id=? AND COALESCE(j.status,'') <> 'cancelled'
       GROUP BY r.service ORDER BY COUNT(*) DESC, r.service ASC`, businessId) as { service: string; jobs: unknown; acres: unknown; agreed: unknown }[];

  const byMachine = await db.all(`SELECT e.id, e.name, e.kind, e.status,
         (SELECT COUNT(*) FROM job_asset ja JOIN job j ON j.id = ja.job_id
            WHERE ja.equipment_id = e.id AND j.status <> 'cancelled') AS jobs,
         (SELECT COUNT(*) FROM equipment_fault f WHERE f.equipment_id = e.id AND f.resolved_at IS NULL) AS faults
       FROM equipment e WHERE e.business_id=? ORDER BY e.status ASC, e.kind ASC, e.created_at ASC`, businessId) as {
      id: string; name: string; kind: string; status: string; jobs: unknown; faults: unknown;
    }[];

  return {
    quotesSent: n(quotes.sent),
    quotesWon: n(quotes.won),
    jobsDone: n(jobs.done),
    jobsOpen: n(jobs.open),
    acresDone: n(jobs.acres),
    agreedMinor: n(money.agreed),
    paidOutMinor: n(money.paid),
    byService: byService.map((s) => ({ service: s.service, jobs: n(s.jobs), acres: n(s.acres), agreedMinor: n(s.agreed) })),
    byMachine: byMachine.map((m) => ({ id: m.id, name: m.name, kind: m.kind, status: m.status, jobs: n(m.jobs), openFaults: n(m.faults) })),
  };
}
