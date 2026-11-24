# Waiting on

Everything the build needs from someone else. Stand-ins are in place so nothing is blocked;
each one is a swap, not a rewrite. Updated 24 Nov 2026.

## 24 Nov 2026: who may see one machine, and should packages stay all-or-nothing?

**Both built. Neither is blocking; both are Karim's to confirm.**

**The asset-owner viewer** (A15) is a grant per machine per email address, made by the business that
owns the machine. The case it is for: a donor or lessor who paid for a tractor and is entitled to
know how it is used. They see its condition, how many days it has worked and how many days it has
been out of action. They see nothing of the provider's farmers, prices, other equipment or
location, and they need no Sagora account — there is no join from the grant table to a request, a
quote or a farmer, which is the only honest way to meet "scoped to named assets only".

**What Karim needs to decide:** whether a viewer should get a login and a screen of their own, or
whether a figure read out on a call is enough for the pilot. Today it is the latter: the data is
there and queryable, with no viewer-facing page.

**Routing is now logged** (A01). Every provider gets a row per request — told, eligible but not
told, or not eligible and why, in words. It is written at the moment the decision is made, so it
still explains a request from last month whose coverage has changed since; `db:why-no-match` could
only ever reconstruct it against coverage as it stands now. The admin screen also lists open
requests **no approved provider can quote**, which is a coverage gap somebody can act on. Worth
watching during the pilot: it answers "is Sagora quietly dropping work" without anyone asking.

## 24 Nov 2026: how long do we hold the machines before the farmer pays?

**A default is in place and the deadline is shown to the farmer. Karim sets the number.**

Until now an accepted quote held its machines for ever. The holds converted to the booking and the
job owned the dates whether or not the farmer ever paid — which is the most expensive thing that
can happen to a provider, because the tractor is unavailable and nobody is paying for it.

`payment_window_hours` defaults to **48**, matching the quote window so a farmer deals with one
number rather than two, and capped at the start of the work: a deadline falling after the work was
due to begin would hold a machine for a day that has already gone.

When it lapses, the **reservation** is released and the **agreement survives**. The price, the plan
and who agreed it are facts, and the farmer may still want the work; only the claim on the calendar
goes, because somebody else could be using that tractor. The farmer is shown the deadline before it
passes and told plainly when it has.

**What Karim needs to decide:** whether 48 hours is right for a farmer paying by mobile money from
a village, and whether a part payment should extend it. Today a part payment does not — the window
runs from acceptance and only a confirmed booking stops it.

## 24 Nov 2026: who earned what, on a job with two machines?

**Built as the handover specifies, with an even split assumed until a provider says otherwise.**

A14 asks for revenue per machine "net of fees and attributable refunds", with allocations that
reconcile and anything unallocated "shown and excluded rather than quietly spread". All of that is
built. Two choices worth confirming:

- **An unstated split is an even one**, and the Reports screen says so in as many words rather than
  presenting a guess as a finding. A provider can state shares per machine on a finished job, and
  they may come to less than 100% — the remainder then shows as a "Not allocated" row.
- **A refund decides where a loss falls, not how much was earned.** A payout's net is already net of
  refunds, because a refund can only be prepared while money is still held and therefore always
  precedes the payout. Subtracting it again would count it twice. So a refund named to one machine
  is added back, the job is divided, and that machine then carries its own refund — the loss lands
  where it belongs and the totals still come to what was actually paid out.

**What Karim needs to decide:** nothing blocking. Worth telling him that per-machine revenue counts
**settled payouts only**, so the figures lag the work by however long the payout queue takes. An
accepted price is not revenue and a confirmed booking is not revenue, because either can still
become a refund.

## 24 Nov 2026: must one provider cover every stage of a package?

**Built as the handover specifies. Karim should know what it costs before it bites.**

Requests can now ask for several operations at once — ploughing, then harrowing, then planting on
the same field — and the handover's rule is all-or-nothing: "all stages must be covered before the
package is quoted." That is what is built. A provider who ploughs and harrows but does not plant
never sees a plough-and-plant request, is never emailed about one, and cannot quote one if they
reach the form by hand.

**The cost.** Three providers are approved for the pilot. A three-stage package needs one of them
to cover all three stages in that district, and if none does, the farmer gets no quotes at all and
no explanation of why. The strict rule is right for the farmer who would otherwise have to
coordinate two providers themselves; it is wrong if it means nothing can be sold.

**What Karim needs to decide:** whether a provider may quote the stages they can do and leave the
farmer to fill the gap. If yes, the change is to the browse filter and the quote gate only — the
reservation, the per-stage plan and the pricing already work stage by stage and would not move.

Two lesser decisions taken as defaults alongside it, both changeable settings:

| Setting | Default | Why that number |
|---|---|---|
| `travel_setup_days` | **1** | The days either side of a job are no longer offered as free. Sierra Leone's districts are large and a tractor moving between two farms is not available for either on the day it travels. One day each side is the conservative guess; Karim may know it is two in the rains |
| `capacity_fresh_hours` | **24** | A provider states at quotation that the machines are working and free of outside commitments. That statement goes stale after a day and then blocks the **dispatch** — not the acceptance, because a farmer should not lose an agreed price over an unclicked button. A day is short enough to mean something and long enough that quoting three requests in an afternoon takes one confirmation |
| `payment_window_hours` | **48** | How long the machines stay held after acceptance with nothing paid. See the entry above |

A request may carry at most four operations (`MAX_OPERATIONS`). Beyond that the last stage's
machines would be held months out on a guess, which is not capacity.

## 23 Nov 2026: when should an unconfirmed pairing stop a quote?

**A default is in place. Karim decides when to switch it on.**

The handover is clear that it should: "wrong or unknown compatibility blocks quotation" (A12), and
equally clear that the shortcut is forbidden — "a catalogue match does not prove compatibility",
and "developers must verify the actual model pairing rather than treating a generic type as an
engineering approval".

Both of those together mean the rule cannot simply be switched on. No provider on Sagora has
recorded a pairing yet, so enforcing it today would stop every quote on the platform, and
auto-approving every pairing of the right type to avoid that is exactly what the handover forbids.

So it is a setting, `pairing_enforced`, and it is **off**:

- **Off** (today) — a quote with an unconfirmed pairing still sends, and the provider is told, on
  the quote and on their equipment screen, that nobody has confirmed the two pieces fit.
- **On** — the same case is refused, naming the implement and the machine.

Readiness is shown either way: a provider sees "Ploughing ready" or "Harrowing missing a harrow"
across the top of their register, so the gap is visible before it costs them a job.

**What Karim needs to decide:** when providers have had long enough to record their pairings, and
whether that is a date or a judgement call per provider. Until then the honest position is that
Sagora knows which pairings are unverified and says so, rather than pretending to have checked.

## 23 Nov 2026: do providers specialise, or does everyone do everything?

**Open. Nothing has been changed while it is open — matching works as the brief specifies.**

A planting request in Bombali was invisible to an approved Bombali provider. Nothing is broken:
a provider is shown a request when one of their active coverage pairs matches it on **district
and service**, and that provider covered Bombali for ploughing and harvesting but not planting.
Chiefdom and village take no part in matching at all — they are there so a provider knows where
they are driving and so staff can find the farm. `npm run db:why-no-match` prints, for every open
request, who can see it and the reason for everyone who cannot.

The rule itself is the brief's, not an assumption: "General requests go to eligible providers
covering the district + service" (PROJECT.md §Requests & agreements). So service matching stays.

What is actually open is whether it matters in practice:

- **If most providers do all three services**, this is a data problem with a sharp edge. Planting
  was added to Sagora after ploughing and harvesting, so every provider approved before that has
  coverage rows for only those two. They look completely correct on their profile — approved, right
  district — and planting work is silently invisible to them. Those providers need planting adding,
  and it is worth asking whether a provider should be told "there are N requests in your district
  you are not covered for" rather than seeing an empty list and assuming there is no work.
- **If providers genuinely specialise**, the present behaviour is already right and the only thing
  to fix is the one provider's coverage.

Two related traps, which look identical to a provider from the outside and should be kept in mind
whichever way the answer goes: a service added *after* approval is written as `pending` and brings
in nothing until staff approve it, and a business not yet `approved` is shown nothing at all.

## 13 Nov 2026: two things to check on the live deployment

Both are about the voice note. The code works either way now, but both are worth putting right.

1. **`AI_MODEL` in Vercel may name a model that does not exist.** The value set for production is
   marked Sensitive, so it cannot be read back to check. If it reads `gemini-3.5-flash`, that is
   not a real model — the real ones are `gemini-2.5-flash` (what this was built and tested
   against) and `gemini-3-pro-preview`. Since 13 Nov the code falls back to `gemini-2.5-flash`
   whenever the configured model is refused, so a wrong value costs one wasted call per recording
   rather than the whole feature. Simplest fix: set `AI_MODEL` to `gemini-2.5-flash`, or remove it
   altogether — unset, the code uses that model anyway.

2. **Migration `023_voice_intake.sql` may never have been applied to production.** Migrations do
   not run on deploy; `npm run db:migrate` has to be run by hand against Neon. Until it is, the
   `voice_intake` table is missing. That used to crash the screen after a farmer had already
   recorded; since 13 Nov the row is written on a best-effort basis and a failure is logged and
   ignored, because the table is for debugging bad transcriptions and is not the product. So the
   feature works without it — but nothing can be debugged until it exists.

## 11 Nov 2026: Karim's answers, and the voice-note feature

**Answered and built:**
- **Deposit rule.** Karim: a booking may confirm on 50% of the agreed price, not only in full.
  `DEPOSIT_POLICY` in `lib/payments.ts` carries the number; the booking decision checks the
  deposit threshold instead of the full amount. What happens to the balance still owed is still
  open — no deadline exists yet, so none was invented; the balance just stays visible as owed,
  the same as it always has.
- **Who pays Monime's fee.** Karim: it comes out of Sagora's own 10%, not a separate charge. No
  code needed — `FEE_POLICY` already is that flat 10%.
- **Document retention.** Karim: 6 months. `DOCUMENT_RETENTION_DAYS=180` is the value to set.
- **Provider approval evidence.** Karim: staff judgment on the uploaded documents, no formal
  checklist. Matches what is already built — resolved as policy, not a code gap.
- **Payout "Paid by"/"Fees" fields, SAGORA_WHATSAPP, Monime sandbox access**: Karim says leave
  for now / ignore / ready for go-live respectively. No action.
- **Who sends payouts, and from what account**: clarified for Karim — Monime only collects from
  farmers today; sending money to providers is still a manual transfer staff record afterward
  (Phase A, PROJECT.md §6.3). The open question is which real account staff send *from*, not a
  code question. Monime auto-disbursing payouts too would be new scope, not yet asked for.
- **Farmer request recovery without SMS**: re-explained for Karim — today a farmer with no code
  and no email calls Sagora, and staff look the request up by phone number (already built). Still
  waiting on whether that is an acceptable permanent answer.

**Built: voice-note request intake.** A farmer (or staff taking a call, or a provider logging a
private job) can record a voice note — or share an existing one, since real voice notes often
arrive via WhatsApp — instead of filling a blank form. Gemini listens to the audio directly and
returns a transcript plus the fields BookForm needs (`lib/gemini.ts`); nothing is ever created
from a voice note directly — it only pre-fills the same `BookForm` the farmer already reviews and
submits. Tested on two real farmer voice notes (not scripted samples) before any UI was built:
both transcribed as fluent, accurate Krio, and the extraction correctly pulled service, land size
(with hectare→acre conversion), district, village and date, while correctly leaving unspoken
fields (name, phone) as null rather than guessing. One real finding: farmers who say "I'll give
you my number" rarely speak it as actual digits, so contact details are always asked for
explicitly, never assumed from voice. The review screen tells each person exactly what is still
missing for them specifically — one gap for one caller, several for another — rather than making
everyone re-answer everything. Relative and vague dates ("this Saturday", "second week of
October") are resolved to a real calendar date against the day the note was recorded, per Karim's
instruction, and stay editable since it is only a best guess.

Inert — the "Send a voice note" CTA simply redirects to the normal form — until
`GOOGLE_GENERATIVE_AI_API_KEY` is set. Needs from here: a native Krio speaker's review of the
on-screen "what to say" guidance text (drafted, not verified); no Figma frame exists for this
screen at all, since it postdates the brief.

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
- ~~Deposit rule~~ and ~~who pays Monime's fee~~ — answered by Karim 11 Nov, see that entry above.
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
| 8 | **The refund deadline and write-off rules** | The 10% pilot fee is signed and live (6 Nov) — this line used to say it was still waiting at 0%, which was stale. Still open: the 5-working-day refund deadline, the 90-day write-off, advance rules |
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
