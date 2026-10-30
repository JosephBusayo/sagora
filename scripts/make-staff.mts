// Gives an existing, verified account the staff role.
// Run: npm run staff:make -- someone@example.com        (add --admin to make them an admin)
//
// There is no public way to become staff: only someone with database access can do this.
// It goes through the application's own data layer, so it works against whichever database
// the environment points at — the SQLite file locally, or Neon on the deployed site. A
// version of this that opened the SQLite file directly would report "no account found" on a
// deployed site while the real account sat untouched in Postgres.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

const email = process.argv[2]?.trim().toLowerCase();
const role = process.argv.includes("--admin") ? "admin" : "staff";
if (!email) {
  console.error("Usage: npm run staff:make -- email@example.com");
  process.exit(1);
}

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { db, describe } = await import("../src/lib/db");

console.log(`Database: ${describe()}`);

// "user" is a reserved word in Postgres, so the quotes are required there and harmless here.
const res = await db.run(`UPDATE "user" SET role = ? WHERE email = ?`, role, email);
if (res.changes) {
  console.log(`${email} is now ${role}. They will be asked for an emailed code on the staff screens.`);
} else {
  console.log(`No account found for ${email}. They must sign up and verify their email first.`);
}
process.exit(0);
