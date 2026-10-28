// Local shortcut so you can see the workspace without running the staff review.
// Run: npm run dev:approve -- provider@example.com
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) { console.error("Usage: npm run dev:approve -- email@example.com"); process.exit(1); }
const db = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "sagora.db"));
const user = db.prepare("SELECT id FROM user WHERE email = ?").get(email) as { id: string } | undefined;
if (!user) { console.error(`No account for ${email}`); process.exit(1); }
const now = new Date().toISOString();
const res = db.prepare(
  "UPDATE provider_business SET status='approved', reviewed_at=?, reviewed_by='dev-script', updated_at=? WHERE user_id=?",
).run(now, now, user.id);
console.log(res.changes ? `${email} is approved. Sign in to reach the workspace.` : `No business found for ${email}. Finish setup first.`);
