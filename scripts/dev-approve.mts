// Local shortcut so you can reach the workspace without running the staff review by hand.
// Run: npm run dev:approve -- provider@example.com
//
// Goes through the application's own data layer, so it works on SQLite and on Postgres alike.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run dev:approve -- email@example.com");
  process.exit(1);
}

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { db, describe } = await import("../src/lib/db");

console.log(`Database: ${describe()}`);

// "user" is a reserved word in Postgres, so the quotes are required there and harmless here.
const user = (await db.get(`SELECT id FROM "user" WHERE email = ?`, email)) as { id: string } | undefined;
if (!user) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}

const now = new Date().toISOString();
const res = await db.run(
  "UPDATE provider_business SET status='approved', reviewed_at=?, reviewed_by='dev-script', updated_at=? WHERE user_id=?",
  now, now, user.id,
);
console.log(
  res.changes
    ? `${email} is approved. Sign in to reach the workspace.`
    : `No business found for ${email}. Finish setup first.`,
);
process.exit(0);
