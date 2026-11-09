# Waiting on

Everything the build needs from someone else. Stand-ins are in place so nothing is blocked;
each one is a swap, not a rewrite. Updated 9 Nov 2026.

## 9 Nov 2026: everything codeable without Karim, the designer or a key, done

A sweep for anything left that was pure coding — buildable now, even if inert until a key is set
or a decision arrives — so nothing below needs a future coding session, only information,
a decision, or an environment variable.

**Built:**
- **Finance desk roles.** Staff carry a `financeAccess` flag (default on, so nothing changes
  today); an admin grants or removes it per person on the Staff screen, and `/staff/payments` —
  collecting money, preparing and approving payouts and refunds, resolving disputes — now checks
  it, page and actions both. Resolves "who sits at the finance desk" below: the mechanism exists,
  Sagora just has to decide whose box to tick.
- **Monime "Verify account" OTP.** `lib/sms.ts` is a seam for outgoing SMS, in the shape of
  `lib/email.ts`. `lib/monime-verify.ts` sends a 6-digit code to the Monime number and checks it
  before `setDestination` saves it, wired into the existing "Add Monime account" form. Inert —
  skipped exactly as before — until `SMS_PROVIDER_URL` and `SMS_PROVIDER_API_KEY` are set. Also
  answers "what does the provider-side Payments — OTP screen protect?": a provider-side OTP
  before a sensitive money action, which the brief already asks for (§4 Auth), is now built; the
  Figma screen's exact wording is no longer blocking anything.
- **Several equipment photos.** A gallery alongside the one cover photo, additive — nothing that
  reads `equipment_photo` changed. Add up to 5 more, remove any of them, from the equipment
  detail window. Migration 022.
- **A hold-days threshold.** The brief's open question "hold / quote / payment expiry rules"
  (§6.3/§10.4) had no answer in code. "Payment exceptions" on the Follow-ups screen now flags a
  held payment as overdue after a configurable number of days (default 2, the same as the other
  thresholds there), editable on that same screen — no code change needed when the number changes.
- **Document retention.** `DOCUMENT_RETENTION_DAYS` is read by a daily purge (added to the
  existing outbox cron). Unset, nothing is deleted — exactly today's behaviour. The day Karim
  gives a number, setting that one variable turns the purge on.
- **Three small corrections, as asked:** the hand-drawn Sagora logo stays — settled, not raised
  again. The bank list stays as built; Joseph will say if it needs to change. The provider-side
  "Payments — OTP" question is removed below — see the Monime OTP item above.

**Deliberately not built — these need a real decision or a real number, not code:**
- **Deposit rule** (booking on partial payment, not full payment). Building this means changing
  the one core booking decision in `lib/payments.ts` — accepted terms + funds + free resources —
  that every money test in the brief is written against. Guessing the mechanics (what happens to
  the balance still owed, on what deadline, what if it is never paid) risks shipping a booking
  rule nobody actually asked for. Needs Karim's explicit answer first; it is then a small, careful
  change, not a rewrite.
- **Who pays Monime's own transaction fee.** This is not only a decision — nobody at Sagora knows
  Monime's fee amount or structure yet. There is nothing to compute until that number exists.
- **Partial-service refund amount.** Already fully supported: `prepareRefund` takes any amount up
  to what is held, so staff can already refund part of a job. What is missing is written guidance
  for staff on how much to refund in which case — Karim's policy content, not a code gap.

## 7 Nov 2026: districts, payouts, guest payments, the outbox timer

Built: several operating districts per provider, each with its own services (UC04). Setup's
district and services become the first ones on approval. A district added later waits for Sagora
to review it (UC03); removing one is immediate, but the last one cannot be removed. Staff review
new districts on the Providers screen and in Follow-ups. Also built: the payout account in the
design's steps (Bank account or Monime, then that account's form), a Payout details window, and
the submitted window's rows. Guests get an invoice download and a Payments list for their
request. The design's photo wording is now on Add equipment. Migration 020.

Still needed from someone:
- **The outbox timer** (Joseph). The 15-minute GitHub workflow (`.github/workflows/outbox.yml`)
  needs two repository secrets: `SAGORA_URL` (https://www.sagora.sl) and `CRON_SECRET`, the
  same value as `CRON_SECRET` in Vercel. Until then, the daily Vercel cron and the queue
  draining itself while people use the site still cover it.
- **Payout details "Paid by" and "Fees"** (Karim): what they mean for a withdrawal. They are left
  out until someone says.
- ~~Monime "Verify account" OTP~~, ~~the bank list~~, ~~several equipment photos~~: built 9 Nov —
  see that entry above.

## 6 Nov 2026: Karim's use cases, the code-only parts

Built: the "Speak to us on WhatsApp" button (landing, farmer sign-in and sign-up, Help, provider
setup status), harvest details with "Not sure" flagged to the provider (UC06), farm inspections
that block a quote until recorded (UC08), readiness, equipment on the way and actual start kept
apart (UC12), repeat callers linked to their open request and approval by phone recorded against
the named person (UC07), operator skills and time away (UC05), business type, person in charge,
terms and private ID/registration documents in setup (UC02), the fee shown on provider Payments
(UC10), an offline notice (UC16), and staff Follow-ups and the Sagora report (UC14).
Migrations 013-018.

Still needed from someone:
- **Sagora's WhatsApp number** (Karim). Set `SAGORA_WHATSAPP` in Vercel, e.g. `+232 …`. The
  button stays hidden until then.
- **Document retention policy** (Karim, UC02): how many days. The purge that reads the number
  exists now (9 Nov) and does nothing until it is set — still today's exact behaviour.
- **Deposit rule, who pays Monime's fees** (Karim, UC09/UC13). See 9 Nov above for why these
  specifically still need a real answer before they can be coded.
- ~~Operating districts (UC04) and a fresh review when coverage changes (UC03)~~: built 7 Nov.
  ~~Hold length~~, ~~partial-service refund rules~~: answered in code 9 Nov — see that entry.

## Where this is, 30 Oct 2026

Written for whoever picks this up next, including a fresh session.

**Done since the 29th**

- The app runs on PostgreSQL as well as SQLite. `DATABASE_URL` set means Postgres, unset means
  a local SQLite file. 87 e2e tests, the 35-step walkthrough and 47 money checks pass on both.
- Neon is the database. Joseph's own Neon account, project `summer-cell-85093947`, region
  `aws-eu-west-2` (London). **London rules out Neon's Object Storage, Functions, AI Gateway and
  Realtime**, which are only in us-east-1/2, eu-central-1 and ap-southeast-1. Nothing built
  needs them; file uploads later would need S3 or R2 instead.
- `npm run db:reset` empties a database and keeps the schema. It names the database first,
  refuses without `--yes`, and refuses outright on `SAGORA_ENV=production`.
- `npm run mail` prints the dev outbox with the sign-up codes pulled out.
- `npm run vercel:env` pushes the production environment into Vercel from `.env.local`.
- Deployed to Vercel at `sagora-three.vercel.app` (Joseph's personal account — see below).
- **Figma access is solved.** Joseph copied the file to his own account, where the MCP
  connector is not rate-limited: `LiwlNONIHcNE1Il3V8pReB`. All 17 sections can be read.
  Items 1-6 below are now gettable rather than blocked.
- Farmer home rebuilt from the frame: the designer's copy, the real colours, type and
  spacing, and the measured box sizes. The designer's words swept across both apps.

**Blocked, 30 Oct**

- **Netim's operation queue is stuck.** Five "create a record" operations on `sagora.sl` have
  been pending since 07:33 CET with no progress — operation numbers 14361850, 14361013,
  14361015, 14361864, 14364103. Until they apply, Resend cannot verify the domain. A support
  ticket is the only move; re-adding records just queues more.
- Until then `EMAIL_FROM` stays unset, so mail goes out as `onboarding@resend.dev`, which
  **only delivers to the address the Resend account was registered with**.

**Next, in order**

1. Run `npm run db:migrate` against the Neon production database. It has probably never been
   migrated, which would make every page on the deployment a 500.
2. `npm run staff:make -- <email>` to create the first staff account. Without one nobody can
   approve a provider or record a payment, and a demo dead-ends on the first screen.
3. Walk the whole path on the deployed site and fix what breaks.
4. The booking flow is missing three fields the design has: **Land access**, **Land condition**
   and **Land clearance**, across two steps. A migration, a reworked form, and showing them to
   the provider when they quote. This is the largest remaining gap on the demo path.
5. Provider payments is missing a whole designed area — wallet, payout details, withdraw
   funds, add payment method. Half of it is Monime, which cannot be opened yet. Left alone
   deliberately: a wallet screen that cannot move money is worse than no wallet screen.

**Accounts, and who they belong to**

Everything except the domain is currently in Joseph's name, agreed as a deliberate trade for
the Monday deadline, to be transferred afterwards.

| Service | Whose | Transfer cost |
|---|---|---|
| Domain `sagora.sl` | **Karim / Kodehut** (Netim) | none, already right |
| GitHub `JosephBusayo/sagora` | Joseph | one button |
| Neon | Joseph | production starts on a fresh project in Karim's org; test data never moves |
| Vercel | Joseph | **Hobby forbids commercial use** — production must not stay here |
| Resend | Joseph | Karim's account re-verifies the same domain |
| Monime | nobody | cannot be opened by a developer, and must not be. Payments are recorded by hand by design, so nothing is blocked on it |


## To revisit

- **Providers covering several districts.** Matching uses the one district from provider setup, so
  a business working across districts cannot say so yet. The Requests district filter has one useful
  choice until this changes. A small follow-up, once it is known whether providers do work that way.
- **The landing page.** A public landing page already exists and will connect to this app. Until
  then `/` redirects to the provider sign-in, so farmers arrive at the wrong door.

## From the designer

| # | What | Where it bites | Stand-in in use |
|---|---|---|---|
| 2 | **Icon corner radius** (1, 2 or 3) | Every icon | Radius 2. Round/filled/stroke-2 are confirmed by measurement; the radius cannot be read from a 22px export |
| 3 | **Auth photos** for the farmer frames (`59-2686`) | Farmer sign-up, sign-in, verify, reset | Provider photos, cropped from the one export |
| 4 | **Real asset exports** for the provider auth photos | Provider auth screens | Crops of `sign_in.jpg` |
| 5 | **Farmer app frames** (`1-2507`, `21-16070`) at usable resolution | Farmer home, Book a service, My requests | Built from layer names plus the shared design system |
| 5b | **My quotes frames** (`15-8170`) | Provider quote form, My quotes table, farmer quote cards | Built in the design system's language, not from a frame |
| 5c | **Equipment frames** (`11-31`, 7 frames) | The equipment register, fault states | Built in the design system's language, not from a frame |
| 5d | **Jobs frames** (`15-9385`, 2 frames) | The jobs list, scheduling, work report | Built in the design system's language, not from a frame |
| 5e | **Payments frames** — provider (`15-10667`, 9 frames) and farmer (`32-21589`, 5 frames) | Provider payments, farmer transactions, the finance desk | Built in the design system's language. The farmer table follows the columns named in the frame list (id, type, amount, date, status) |
| 5f | **Bookings, Notifications and Farmer Settings frames** — `30-19534`, `35-23756`, `35-25885`, `55-515` | Farmer bookings, both notification lists, farmer settings | Built in the design system's language. The booking tabs follow the four states named in the frame list |
| 5g | **Provider Dashboard frame** (`1-2506`) | The provider's home screen | Built from what the other screens can actually count. The design's "Home-tractors" variant has never been exported |
| 5h | **A Reports frame** | `/provider/reports` | None exists in the file at all. The sidebar has the entry, so something was intended. Still a placeholder |
| 6 | **Screens that do not exist in Figma** | Staff review queue, invite acceptance, "not built yet" placeholder, provider setup and approval | Built in the design system's language, not from a frame |
| 7 | **Confirm the farmer sign-up title** | Farmer sign-up | The Figma frame says "Create a provider account", which looks like a copy slip. Build says "Create an account" |
| 8 | **Confirm the verification button label** | Email verification | The frame repeats "Get verification code". Build says "Verify" |
| 9 | **Error, success and hover styling** | Everywhere | Invented: red for errors, green for success, a darker green on button hover |
| 10 | **A state for a brand-new request** | Provider Requests | The design shows Quotes sent / In progress / Cancelled / Completed, but nothing for a request nobody has quoted yet. Build says "Awaiting quotes" |

A **Dev or Full Figma seat** on the team that owns the file would settle 1-6 at once: it would let
the real tokens, assets and frames be pulled directly instead of measured off a JPEG.

## From Karim (the client)

| # | What | Why it matters |
|---|---|---|
| 1 | **Where production Postgres lives, and who pays** | Supabase, Neon and others all work. Free tiers cover us until real users arrive, so this is not urgent, but it shapes deployment |
| 2 | **Monime sandbox access and terms** | Now blocks **only** the automatic part. Payments, booking, payouts, refunds and reconciliation all work by hand today; Monime replaces the "record it by hand" step with a webhook |
| 3 | **A Monime account in his own name** | It holds his money and his KYC. It must never be in the developer's name |
| 4 | **The domain, registered in his name** | Moving a domain between owners is slow and avoidable |
| 5 | **Farmer request recovery without SMS** (§6.2) | Many farmers have no email. Open question in the brief, and it changes the intake design |
| 6 | **Stack confirmation** | Section 10 decisions are still unconfirmed. Nothing is blocked, but he should know what is being built |
| 7 | **Who approves providers, and against what evidence** | The approval screen works; the policy behind it is undefined |
| 8 | **The signed fee and refund policy sheet** | The 10% pilot fee (waived for the first 20 jobs), the 5-working-day refund deadline, the 90-day write-off, advance rules. All built; the fee is set to **0%** until this is signed |
| 9 | ~~Who sits at the finance desk, and who may approve~~ | **Built 9 Nov**: an admin grants or removes finance-desk access per staff member on the Staff screen. Money out still always needs two different people; Sagora now also decides who is eligible at all |
| 10 | **A bank or mobile money account to send payouts from** | Payouts are recorded against a transfer reference. Someone has to actually make the transfers |

## From Joseph

| # | What |
|---|---|
| 1 | **Central Icons licence key on every build machine** — CI and the deploy host, not just the laptop. `npm install` fails without it |
| 2 | **Confirm the remaining sidebar sections** are wanted as designed — Dashboard, Reports, Notifications |

## Known gaps in the build itself

Not waiting on anyone; just not written yet.

- ~~MFA for staff~~ — **done.** A staff password now only reaches `/staff/verify`; an emailed 7-digit code opens the rest.
- ~~Changing a sign-in email~~ — **done**, 6 Nov. Settings > Account sends a code to the new address first.
- ~~Finance desk roles~~ — **done**, 9 Nov. See that entry above.
- ~~A scheduled drain for the notification outbox~~: **done.** A daily Vercel cron, a 15-minute GitHub workflow (needs its secrets, see 7 Nov), and pages draining a due item at most once a minute.
- ~~SQL migration files~~ — **done.** The schema is `migrations/*.sql`, applied once each and checksummed. Nothing creates tables at runtime.
- ~~The async conversion~~ — **done.** Every query is awaited and every transaction is a `db.tx(...)` callback, which is what a connection pool needs. The Postgres move is now one file: `lib/db.ts`.
- **The Postgres move itself** — waiting only on the Neon account, which waits on Karim's email.

## Design gaps from the Figma audit (31 October 2026)

- ~~Equipment photos~~ and ~~the detail dialog and three-step add~~: built (one photo each).
- Payouts: ~~bank and Monime method picker~~ built; the OTP step and fees still need answers (see 7 Nov).
- Provider Payments: columns and filters differ from the design until real transaction records exist.
- Not in the design at all: staff screens, mobile layouts, Help. (Reports has no frame either, but was built anyway, 6 Nov — see "What is left" further up.)
