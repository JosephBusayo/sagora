// One-off repair. 023_voice_intake.sql was applied to Neon outside our migrate script — its
// schema_migrations row carries an empty checksum and a timestamp in a different format from
// every other row. An empty checksum can never match the file, so every later migration was
// blocked by a mismatch that was really a missing record.
//
// The table itself was verified column by column first: same eight columns, types, NOT NULLs and
// defaults, both CHECK constraints, the primary key and the created_at index. So this records the
// checksum the file actually has. It is not editing applied history; it is writing down history
// that was never written.
//
// Guarded to that one row, and only while the checksum is still blank, so running it twice is
// harmless and it can never overwrite a real checksum.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
import { createHash } from "node:crypto";
import fs from "node:fs";

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();
const { db, describe } = await import("../src/lib/db");

const NAME = "023_voice_intake.sql";
const sql = fs.readFileSync(`migrations/${NAME}`, "utf8");
// The same normalisation src/lib/migrate.ts uses, so the value matches what it will compute.
const checksum = createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");

console.log(`Database: ${describe()}`);
console.log(`Recording checksum ${checksum.slice(0, 12)}… for ${NAME}`);

const res = await db.run(
  "UPDATE schema_migrations SET checksum = ? WHERE name = ? AND (checksum = '' OR checksum IS NULL)",
  checksum, NAME);
console.log(res.changes ? "Repaired 1 row." : "Nothing to repair — it already has a checksum.");
