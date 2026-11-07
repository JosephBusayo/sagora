import "server-only";
import { db } from "./db";
import { getSetting } from "./follow-ups";

/**
 * Sagora's own results (UC14), across every provider. Each stage is counted on its own, so a
 * started job is never counted as finished and money still moving is shown, not hidden in a
 * total. Test activity is left out: requests from the test emails set here, and every payment
 * made with a Monime test token.
 */

export const TEST_EMAILS_KEY = "test_emails";

export async function testEmails(): Promise<string[]> {
  return ((await getSetting(TEST_EMAILS_KEY)) ?? "").split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export type SagoraReport = {
  since: string | null;
  requests: number; accepted: number; booked: number; started: number; startedNotFinished: number; completed: number;
  acresDelivered: number;
  farmerPaidMinor: number; feesMinor: number; paidToProvidersMinor: number; refundedMinor: number;
  moneyWaiting: number; openCases: number;
  repeatCustomers: number;
  notServed: { reason: string; count: number }[];
  excludedRequests: number;
};

const n = (v: unknown) => Number(v ?? 0);

export async function sagoraReport(sinceDays: number | null): Promise<SagoraReport> {
  const since = sinceDays ? new Date(Date.now() - sinceDays * 86400_000).toISOString() : null;
  const tests = await testEmails();
  const all = await db.all(`SELECT r.id, r.status, r.farmer_id, r.contact_phone, r.contact_email, r.created_at, u.email AS farmer_email, b.email AS business_email
       FROM service_request r LEFT JOIN "user" u ON u.id = r.farmer_id
       LEFT JOIN agreement a ON a.request_id = r.id LEFT JOIN provider_business b ON b.id = a.business_id
       WHERE r.private_to IS NULL`) as
    { id: string; status: string; farmer_id: string | null; contact_phone: string; contact_email: string; created_at: string; farmer_email: string | null; business_email: string | null }[];
  const isTest = (r: (typeof all)[number]) =>
    [r.contact_email, r.farmer_email, r.business_email].some((e) => e && tests.includes(e.toLowerCase()));
  const inWindow = all.filter((r) => !since || r.created_at >= since);
  const real = inWindow.filter((r) => !isTest(r));
  const ids = new Set(real.map((r) => r.id));
  const keep = <T extends { request_id: string }>(rows: T[]) => rows.filter((x) => ids.has(x.request_id));

  const agreements = keep(await db.all("SELECT request_id FROM agreement") as { request_id: string }[]);
  const bookings = keep(await db.all("SELECT request_id FROM booking") as { request_id: string }[]);
  const jobs = keep(await db.all("SELECT request_id, status, started_at, reported_acres FROM job") as
    { request_id: string; status: string; started_at: string | null; reported_acres: number | null }[]);
  const started = jobs.filter((j) => j.started_at || ["in_progress", "work_reported", "completed", "disputed"].includes(j.status));
  const completed = jobs.filter((j) => j.status === "completed");
  const payments = keep(await db.all("SELECT request_id, amount_minor, method FROM payment") as { request_id: string; amount_minor: number; method: string }[])
    .filter((p) => p.method !== "monime_test");
  const releases = keep(await db.all("SELECT request_id, kind, status, fee_minor, net_minor FROM release") as
    { request_id: string; kind: string; status: string; fee_minor: number; net_minor: number }[]);
  const cases = keep(await db.all("SELECT request_id, kind FROM exception_case WHERE status='open'") as { request_id: string; kind: string }[]);

  // A repeat customer has more than one agreed job: by account, or by phone for those who call.
  const agreedIds = new Set(agreements.map((a) => a.request_id));
  const byCustomer = new Map<string, number>();
  for (const r of real.filter((x) => agreedIds.has(x.id))) {
    const who = r.farmer_id ?? `phone:${r.contact_phone.replace(/\D/g, "").slice(-8)}`;
    byCustomer.set(who, (byCustomer.get(who) ?? 0) + 1);
  }

  const quoted = new Set((await db.all("SELECT DISTINCT request_id FROM quote") as { request_id: string }[]).map((q) => q.request_id));
  const cancelled = real.filter((r) => r.status === "cancelled");
  const notServed = [
    { reason: "Withdrawn by the farmer before any quote", count: cancelled.filter((r) => !quoted.has(r.id)).length },
    { reason: "Withdrawn by the farmer after quotes", count: cancelled.filter((r) => quoted.has(r.id) && !agreedIds.has(r.id)).length },
    { reason: "No provider has quoted yet", count: real.filter((r) => r.status === "awaiting_quotes").length },
    { reason: "Quoted, but the farmer has not accepted", count: real.filter((r) => r.status === "quotes_sent" && !agreedIds.has(r.id)).length },
    { reason: "Stopped: no replacement equipment", count: cases.filter((c) => c.kind === "no_replacement").length },
  ];

  const sum = (rows: { amount_minor?: number; fee_minor?: number; net_minor?: number }[], k: "amount_minor" | "fee_minor" | "net_minor") =>
    rows.reduce((t, r) => t + n(r[k]), 0);
  const paidPayouts = releases.filter((r) => r.kind === "payout" && r.status === "paid");
  return {
    since,
    requests: real.length,
    accepted: agreements.length,
    booked: bookings.length,
    started: started.length,
    startedNotFinished: started.filter((j) => j.status !== "completed").length,
    completed: completed.length,
    acresDelivered: completed.reduce((t, j) => t + n(j.reported_acres), 0),
    farmerPaidMinor: sum(payments, "amount_minor"),
    // Sagora's revenue is the fee only. What reaches providers is theirs, and shown apart.
    feesMinor: sum(paidPayouts, "fee_minor"),
    paidToProvidersMinor: sum(paidPayouts, "net_minor"),
    refundedMinor: sum(releases.filter((r) => r.kind === "refund" && r.status === "paid"), "net_minor"),
    moneyWaiting: releases.filter((r) => r.status === "prepared" || r.status === "approved").length,
    openCases: cases.length,
    repeatCustomers: [...byCustomer.values()].filter((c) => c > 1).length,
    notServed,
    excludedRequests: inWindow.length - real.length,
  };
}
