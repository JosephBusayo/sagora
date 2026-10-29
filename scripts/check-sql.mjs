// Catches SQL that works on SQLite and quietly misbehaves on PostgreSQL.
// Run: npm run check:sql  (also runs as part of npm run test:e2e)
//
// These are not syntax errors. Postgres accepts every line this finds and returns a row — just
// with a different key than the code asks for, so the value reads as undefined and whatever
// depended on it does nothing at all. One of these stopped every booking confirmation email
// from sending, while the screen still said the job was booked.
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "e2e", "scripts", "migrations"];
const EXTS = new Set([".ts", ".tsx", ".mts", ".mjs", ".sql"]);

const RULES = [
  {
    // Postgres lower-cases an unquoted identifier: `AS farmerEmail` comes back as `farmeremail`.
    name: "unquoted camelCase alias",
    test: /\bAS\s+(?!")[a-z]+[A-Z]\w*/g,
    fix: 'quote it — AS "farmerEmail" — so the key keeps its capitals',
  },
  {
    // SQLite's date functions do not exist in Postgres, which has now() and interval instead.
    name: "SQLite-only date function",
    test: /\b(datetime|strftime|julianday)\s*\(/gi,
    fix: "build the timestamp in JavaScript and bind it, the way the rest of the code does",
  },
  {
    // Postgres spells this ON CONFLICT DO NOTHING.
    name: "INSERT OR IGNORE / REPLACE",
    test: /\bINSERT\s+OR\s+(IGNORE|REPLACE)\b/gi,
    fix: "use INSERT ... ON CONFLICT DO NOTHING",
  },
  {
    name: "IFNULL",
    test: /\bIFNULL\s*\(/gi,
    fix: "use COALESCE, which both engines have",
  },
  {
    name: "GROUP_CONCAT",
    test: /\bGROUP_CONCAT\s*\(/gi,
    fix: "use STRING_AGG, or gather the rows and join them in JavaScript",
  },
];

/** Ignore a line that says it is deliberate: `// sql-check: ok — <reason>` */
const EXCUSED = /sql-check:\s*ok/;

function* files(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      yield* files(full);
    } else if (EXTS.has(path.extname(e.name))) {
      yield full;
    }
  }
}

const SELF = path.normalize("scripts/check-sql.mjs");

const problems = [];
for (const file of ROOTS.flatMap((r) => [...files(r)])) {
  if (path.normalize(file) === SELF) continue; // this file describes the patterns, so it contains them

  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (EXCUSED.test(line)) return;
    for (const rule of RULES) {
      rule.test.lastIndex = 0;
      const hit = rule.test.exec(line);
      if (hit) problems.push({ file, line: i + 1, rule, text: hit[0], source: line.trim() });
    }
  });
}

if (problems.length === 0) {
  console.log("SQL is portable: no SQLite-only spellings found.");
  process.exit(0);
}

console.error(`Found ${problems.length} place${problems.length === 1 ? "" : "s"} where the SQL would behave differently on Postgres:\n`);
for (const p of problems) {
  console.error(`  ${p.file}:${p.line}  ${p.rule.name} — ${p.text}`);
  console.error(`    ${p.source.slice(0, 110)}`);
  console.error(`    Fix: ${p.rule.fix}\n`);
}
console.error("If one of these is deliberate, put `// sql-check: ok` on the same line and say why.");
process.exit(1);
