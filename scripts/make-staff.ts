// Gives an existing, verified account the staff role. Run: npm run staff:make -- someone@example.com
// There is no public way to become staff: only someone with database access can do this.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run staff:make -- email@example.com");
  process.exit(1);
}
const db = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "sagora.db"));
const res = db.prepare("UPDATE user SET role = 'staff' WHERE email = ?").run(email);
console.log(res.changes ? `${email} is now staff.` : `No account found for ${email}.`);
