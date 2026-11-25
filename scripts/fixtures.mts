/**
 * Shared fixtures for the check:* scripts.
 *
 * They used to build their own accounts inline, which was fine while a quote needed nothing but a
 * price. Since Karim's handover of 23 November a quote cannot be sent without an actual machine and
 * an actual operator held for the dates, so every script now needs the same four things set up in
 * the same order. One copy of that, rather than three that drift.
 */
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";

/**
 * Refuses to write fixtures into anything but a throwaway SQLite file.
 *
 * On 24 November 2026 the check:* suites were run with DATABASE_URL uncommented in .env.local.
 * src/lib/db.ts picks the Postgres driver whenever a URL is present and ignores DATABASE_PATH
 * entirely, so suites that looked like they were building scratch databases wrote approved
 * provider businesses, equipment, farmers, requests and quotes straight into the hosted one.
 *
 * Passing DATABASE_PATH is not isolation and never was. This is. It runs once, on import, before
 * any fixture can be created — so the mistake costs a one-line error message instead of a cleanup
 * script.
 */
if (process.env.DATABASE_URL) {
  console.error(
    [
      "",
      "Refusing to run: DATABASE_URL is set, so this would write test fixtures into a real database.",
      "",
      "DATABASE_PATH does not help — src/lib/db.ts ignores it whenever a URL is present.",
      "Comment DATABASE_URL and DATABASE_URL_UNPOOLED out of .env.local, then run the suite again.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const now = () => new Date().toISOString();

export const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export async function user(name: string, role = "farmer"): Promise<string> {
  const id = randomUUID();
  await db.run(`INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
     VALUES (?,?,?,?,?,?,?)`, id, name, `${id}@example.test`, true, role, now(), now());
  return id;
}

export async function business(ownerId: string, name: string, district = "Bo", services = ["ploughing"]): Promise<string> {
  const id = randomUUID();
  await db.run(`INSERT INTO provider_business (id, user_id, name, phone, email, district, town, operating_districts, services, status, created_at, updated_at)
     VALUES (?,?,?,'76000000',?,?,'Testville',?,?,'approved',?,?)`,
    id, ownerId, name, `${id}@example.test`, district, JSON.stringify([district]), JSON.stringify(services), now(), now());
  for (const service of services) {
    await db.run(`INSERT INTO provider_coverage (business_id, district, service, status, requested_at, decided_at)
       VALUES (?,?,?,'active',?,?) ON CONFLICT DO NOTHING`, id, district, service, now(), now());
  }
  return id;
}

/** A machine on the register, ready to be held by a quote. */
export async function machine(businessId: string, name: string, kind = "machine"): Promise<string> {
  const id = randomUUID();
  // Approved on the way in: these stand for machines already on the register and already
  // working. The approval gate itself is proved in check-register.mts, which sets `review` by
  // hand rather than leaning on what a fixture happens to default to.
  await db.run(`INSERT INTO equipment (id, business_id, kind, name, identifier, ownership, notes,
       brand, model, year, horsepower, implements, services, availability, review, reviewed_by,
       reviewed_at, created_at, updated_at)
     VALUES (?,?,?,?,?,'owned','', '', '', '', '', '', ?, 'available', 'approved', 'fixture', ?, ?, ?)`,
    id, businessId, kind, name, `SN-${id.slice(0, 8)}`, "ploughing,harvesting,planting", now(), now(), now());
  return id;
}

/** An operator on the team, who can be named on a quote. */
export async function operator(businessId: string, name: string): Promise<string> {
  const id = randomUUID();
  await db.run(`INSERT INTO team_member (id, business_id, user_id, name, phone, email, role, permission,
       status, skills, away_from, away_to, created_at, updated_at)
     VALUES (?,?,NULL,?,'76000002',?,'operator','view_jobs','active','ploughing','','',?,?)`,
    id, businessId, name, `${id}@example.test`, now(), now());
  return id;
}

export type Provider = { owner: string; biz: string; machine: string; operator: string };

/** Everything one provider needs before they can quote: a login, a business, a machine, a driver. */
export async function provider(label: string, district = "Bo", services = ["ploughing"]): Promise<Provider> {
  const owner = await user(`Owner ${label}`, "provider");
  const biz = await business(owner, `Business ${label}`, district, services);
  return {
    owner, biz,
    machine: await machine(biz, `Tractor ${label}`),
    operator: await operator(biz, `Driver ${label}`),
  };
}

/** The quote input shape, with the handover's required fields filled in. */
export function quoteInput(p: Provider, startDate: string, over: Partial<{
  amountMinor: number; includes: string; note: string; daysToComplete: number;
  dailyRateMinor: number; assetIds: string[]; operatorId: string;
}> = {}) {
  const daysToComplete = over.daysToComplete ?? 2;
  const amountMinor = over.amountMinor ?? 150000;
  return {
    amountMinor,
    includes: over.includes ?? "Tractor and plough",
    startDate,
    note: over.note ?? "",
    daysToComplete,
    dailyRateMinor: over.dailyRateMinor ?? Math.floor(amountMinor / daysToComplete),
    assetIds: over.assetIds ?? [p.machine],
    operatorId: over.operatorId ?? p.operator,
  };
}
