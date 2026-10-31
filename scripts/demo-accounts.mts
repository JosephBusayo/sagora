// Creates a farmer and an approved provider for people testing the site, ready to sign in.
// Run: npm run demo:accounts
//
// Email codes are only needed once, at sign-up, so a verified account signs in with a password.
// Until the sending domain verifies, that is the only way someone without the Resend account's
// inbox can get in. The passwords are random and printed once, here, for the person running this.
// Running it again leaves existing accounts and their passwords alone.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

import { randomBytes, randomUUID } from "node:crypto";

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { db, describe } = await import("../src/lib/db");
const { auth } = await import("../src/lib/auth");
const { ensureOwner } = await import("../src/lib/team");

console.log(`Database: ${describe()}\n`);

const password = () => `Sagora-${randomBytes(6).toString("hex")}`;

/** Returns the account's id and new password, or null if it already existed. */
async function create(email: string, name: string, phone: string, role: "farmer" | "provider", businessName?: string) {
  const existing = await db.get(`SELECT id FROM "user" WHERE email = ?`, email);
  if (existing) return null;

  const pass = password();
  const res = await auth.api.signUpEmail({ body: { name, email, password: pass, phone, businessName } });
  await db.run(`UPDATE "user" SET role = ?, "emailVerified" = ? WHERE id = ?`, role, true, res.user.id);
  // Signing up queues a code for a mailbox nobody reads. Without this it retries and fails.
  await db.run("DELETE FROM notification_outbox WHERE recipient = ?", email);
  return { id: res.user.id, pass };
}

const FARMER = { email: "demo.farmer@sagora.sl", name: "Demo Farmer", phone: "+23276000001" };
const PROVIDER = { email: "demo.provider@sagora.sl", name: "Demo Provider", phone: "+23276000002", business: "Demo Tractors" };

const farmer = await create(FARMER.email, FARMER.name, FARMER.phone, "farmer");
console.log(farmer ? `Farmer    ${FARMER.email}\n          password: ${farmer.pass}\n` : `Farmer    ${FARMER.email} already exists. Its password is unchanged.\n`);

const provider = await create(PROVIDER.email, PROVIDER.name, PROVIDER.phone, "provider", PROVIDER.business);
if (provider) {
  const now = new Date().toISOString();
  const businessId = randomUUID();
  // Approved from the start: Sagora's review is not what these accounts are for testing.
  await db.run(`INSERT INTO provider_business (id, user_id, name, phone, email, district, town, services, description, status, submitted_at, reviewed_at, reviewed_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'approved',?,?,'demo-script',?,?)`,
    businessId, provider.id, PROVIDER.business, PROVIDER.phone, PROVIDER.email, "Bombali", "Makeni",
    JSON.stringify(["ploughing", "harvesting"]), "A test business for trying Sagora.", now, now, now, now);
  await ensureOwner(businessId, { id: provider.id, name: PROVIDER.name, email: PROVIDER.email, phone: PROVIDER.phone });
  console.log(`Provider  ${PROVIDER.email}\n          password: ${provider.pass}\n`);
} else {
  console.log(`Provider  ${PROVIDER.email} already exists. Its password is unchanged.\n`);
}

console.log("Farmers sign in at /farmer/sign-in, providers at /provider/sign-in. No code is needed.");
process.exit(0);
