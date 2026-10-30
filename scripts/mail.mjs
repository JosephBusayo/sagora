// Shows the emails the app has "sent" while there is no email provider configured.
// Run: npm run mail            (the most recent 5)
//      npm run mail -- 20      (the most recent 20)
//      npm run mail -- aminata@example.com   (only that person's, most recent first)
//
// With no RESEND_API_KEY set, every message is appended to data/dev-outbox.jsonl instead of
// being sent. That is where the 7-digit sign-up codes live during development and testing.
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "dev-outbox.jsonl");

if (!fs.existsSync(FILE)) {
  console.log("No emails yet.\n");
  console.log("The file appears the first time the app sends one — signing up, for instance.");
  console.log(`Looked in: ${FILE}`);
  process.exit(0);
}

const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 5);
const who = args.find((a) => a.includes("@"))?.toLowerCase();

const all = fs
  .readFileSync(FILE, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null; // a half-written line, if the app was mid-append
    }
  })
  .filter(Boolean);

const mine = who ? all.filter((m) => String(m.to).toLowerCase() === who) : all;

if (mine.length === 0) {
  console.log(who ? `No emails to ${who}.` : "No emails yet.");
  process.exit(0);
}

// Newest first: while testing, the message you want is nearly always the last one sent.
const shown = mine.slice(-count).reverse();

console.log(`${shown.length} most recent of ${mine.length}${who ? ` to ${who}` : ""}:\n`);

for (const m of shown) {
  const code = /\b(\d{7})\b/.exec(String(m.text))?.[1];
  const link = /(https?:\/\/\S+)/.exec(String(m.text))?.[1];

  console.log("─".repeat(72));
  console.log(`To:      ${m.to}`);
  console.log(`Subject: ${m.subject}`);
  if (m.at) console.log(`Sent:    ${m.at}`);
  if (code) console.log(`\n  CODE:  ${code}\n`);
  if (link) console.log(`  LINK:  ${link}\n`);
  if (!code && !link) console.log(`\n${String(m.text).trim()}\n`);
}
console.log("─".repeat(72));
