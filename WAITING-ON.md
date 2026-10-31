# Waiting on

Everything the build needs from someone else. Stand-ins are in place so nothing is blocked;
each one is a swap, not a rewrite. Updated 30 Oct 2026.

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
| 1 | **Sagora logo, as SVG** | Sidebar, all auth screens | Hand-drawn asterisk — the only hand-drawn graphic left |
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
| 9 | **Who sits at the finance desk, and who may approve** | Money out needs two different people. Right now any staff account can prepare and any other can approve — there are no finance roles yet |
| 10 | **A bank or mobile money account to send payouts from** | Payouts are recorded against a transfer reference. Someone has to actually make the transfers |
| 11 | **What the provider-side "Payments — OTP" screen protects** | It is in the design (`15-10667`) with no explanation. Best guess: changing where payouts are sent. Staff MFA is built; this one is not, because nobody has said what it is for |

## From Joseph

| # | What |
|---|---|
| 1 | **Central Icons licence key on every build machine** — CI and the deploy host, not just the laptop. `npm install` fails without it |
| 2 | **Confirm the remaining sidebar sections** are wanted as designed — Dashboard, Reports, Notifications |

## Known gaps in the build itself

Not waiting on anyone; just not written yet.

- ~~MFA for staff~~ — **done.** A staff password now only reaches `/staff/verify`; an emailed 7-digit code opens the rest.
- **Changing a sign-in email** — needs re-verification; no design exists.
- **A scheduled drain for the notification outbox** — the queue retries when something triggers it, and staff can drain it by hand at `/staff/outbox`. Nothing runs it on a timer yet; that belongs with hosting.
- ~~SQL migration files~~ — **done.** The schema is `migrations/*.sql`, applied once each and checksummed. Nothing creates tables at runtime.
- ~~The async conversion~~ — **done.** Every query is awaited and every transaction is a `db.tx(...)` callback, which is what a connection pool needs. The Postgres move is now one file: `lib/db.ts`.
- **The Postgres move itself** — waiting only on the Neon account, which waits on Karim's email.
