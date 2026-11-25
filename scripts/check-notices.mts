/**
 * The notification rules, checked without a browser. Run against a throwaway database:
 *   DATABASE_PATH=<scratch>/n.db npm run db:migrate && DATABASE_PATH=<scratch>/n.db npm run check:notices
 *
 * Written after Karim reported several emails from one action (Joseph, 25 Nov 2026). The outbox
 * has always had duplicate protection; what it did not have was protection that worked in the two
 * places that matter — a key built from the clock is not a key, and a key unique across the whole
 * table silently drops the second person an event has to reach.
 *
 * So these hold the line from both sides: one event never emails the same person twice, and two
 * different events, or two people on one event, are never collapsed into one.
 */
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
const { db } = await import("../src/lib/db");
const outbox = await import("../src/lib/outbox");

const fails: string[] = [];
let n = 0;
const ok = (what: string, cond: boolean) => {
  n++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) fails.push(what);
};

const queued = async (to: string, kind: string) => {
  const rows = await db.all("SELECT id FROM notification_outbox WHERE recipient=? AND kind=?", to, kind);
  return rows.length;
};

const farmer = "farmer@example.test";
const provider = "provider@example.test";

/* ------------------------------------------------- one action, one email */

console.log("\nThe same event queued twice is one email");
const first = await outbox.enqueue({ to: farmer, kind: "quote.accepted", subject: "Accepted", text: "x", dedupeKey: "quote.accepted:q1" });
const again = await outbox.enqueue({ to: farmer, kind: "quote.accepted", subject: "Accepted", text: "x", dedupeKey: "quote.accepted:q1" });
ok("the first is stored", first !== null);
ok("the second is refused", again === null);
ok("and only one is queued", (await queued(farmer, "quote.accepted")) === 1);

console.log("\nOne event still reaches both people it is about");
await outbox.enqueue({ to: farmer, kind: "job.dispute_resolved", subject: "Resolved", text: "x", dedupeKey: "job.dispute_resolved:r1:refund" });
const other = await outbox.enqueue({ to: provider, kind: "job.dispute_resolved", subject: "Resolved", text: "x", dedupeKey: "job.dispute_resolved:r1:refund" });
ok("the second recipient is not mistaken for a duplicate", other !== null);
ok("the farmer has one", (await queued(farmer, "job.dispute_resolved")) === 1);
ok("the provider has one", (await queued(provider, "job.dispute_resolved")) === 1);

console.log("\nDifferent events are not collapsed into one");
await outbox.enqueue({ to: farmer, kind: "quote.sent", subject: "A quote", text: "x", dedupeKey: "quote:q1" });
const second = await outbox.enqueue({ to: farmer, kind: "quote.sent", subject: "Another quote", text: "x", dedupeKey: "quote:q2" });
ok("a second quote is its own notice", second !== null);
ok("both are queued", (await queued(farmer, "quote.sent")) === 2);

console.log("\nA key built from the clock is not duplicate protection");
const clockA = await outbox.enqueue({ to: farmer, kind: "coverage.approved", subject: "Areas", text: "x", dedupeKey: `coverage:b1:${Date.now()}` });
await new Promise((r) => setTimeout(r, 2));
const clockB = await outbox.enqueue({ to: farmer, kind: "coverage.approved", subject: "Areas", text: "x", dedupeKey: `coverage:b1:${Date.now()}` });
ok("two clock keys both store, which is the bug", clockA !== null && clockB !== null);
await db.run("DELETE FROM notification_outbox WHERE kind='coverage.approved'");
// What the code does now: the key describes the decision, so the second press finds it used.
const decided = "coverage:b1:approved:Bombali/ploughing";
const realA = await outbox.enqueue({ to: farmer, kind: "coverage.approved", subject: "Areas", text: "x", dedupeKey: decided });
const realB = await outbox.enqueue({ to: farmer, kind: "coverage.approved", subject: "Areas", text: "x", dedupeKey: decided });
ok("a key describing the decision stores once", realA !== null && realB === null);
ok("and one email is queued", (await queued(farmer, "coverage.approved")) === 1);

console.log("\nAn unkeyed message is never deduplicated by accident");
const freeA = await outbox.enqueue({ to: farmer, kind: "otp.sign_in", subject: "Your code", text: "123456" });
const freeB = await outbox.enqueue({ to: farmer, kind: "otp.sign_in", subject: "Your code", text: "654321" });
ok("two sign-in codes are two emails", freeA !== null && freeB !== null);

/* ------------------------------------------------- the send itself */

console.log("\nA row is sent once, and a retry carries its own idempotency key");
const sent: { to: string; key?: string }[] = [];
const realFetch = globalThis.fetch;
process.env.RESEND_API_KEY = "re_test_key";
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const headers = (init.headers ?? {}) as Record<string, string>;
  sent.push({ to: JSON.parse(String(init.body)).to[0], key: headers["Idempotency-Key"] });
  return { ok: true, status: 200, text: async () => "" } as Response;
}) as typeof fetch;

await db.run("DELETE FROM notification_outbox");
const id = await outbox.enqueue({ to: farmer, kind: "quote.sent", subject: "One", text: "x", dedupeKey: "send:1" });
await outbox.drain();
ok("it was sent", sent.length === 1);
ok("with the row's own id as the key", sent[0]?.key === id);
await outbox.drain();
ok("a second drain does not send it again", sent.length === 1);

// The case that produced real duplicates: the send succeeded, the "sent" write did not, and the
// row was still pending next time round. The key is what stops the provider delivering twice.
await db.run("UPDATE notification_outbox SET status='pending', next_attempt_at=? WHERE id=?", new Date(0).toISOString(), id);
await outbox.drain();
ok("a row that stayed pending is retried", sent.length === 2);
ok("under the same key, so it is one email at the provider", sent[1]?.key === sent[0]?.key);

globalThis.fetch = realFetch;
delete process.env.RESEND_API_KEY;

console.log(`\n${n - fails.length}/${n} checks passed.`);
if (fails.length) process.exit(1);
