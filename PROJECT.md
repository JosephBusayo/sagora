# Sagora 2.0 — Project Source of Truth

> Living document. If it isn't written here, it isn't decided.
> Last updated: 2026-10-27 · Developer: Joseph · Client contact: Karim Sawaneh (Kodehut) · Source brief: *Sagora 2.0 Design and Development Brief*, 9 Oct 2026

---

## 1. What we're building

Sagora is a web platform for agricultural service work in **Sierra Leone**.

- **Farmers** request work (ploughing, harvesting) — with or without an account.
- **Providers** (businesses with tractors, attachments, operators) quote, schedule and run jobs.
- **Coordinators** (Sagora staff) help with intake, provider approval and follow-up.
- **Finance staff** control payment exceptions and money releases.

**Goal:** one reliable workflow connecting requests → equipment → people → schedules → agreements → money, so providers can run their daily operations and farmers can arrange work without technical help.

**Key principle:** a *request* is an expression of need — **not** a confirmed booking or a promise that equipment is available. The UI must make this distinction clear everywhere.

---

## 2. Where we're starting from

| Fact | Status |
|---|---|
| Existing code / GitHub repo | **None available. Greenfield build.** |
| Old systems the client used | Not accessible. |
| Designs | Figma file from the designer, in progress (see §9). |
| SMS / OTP | **Dropped for now** (client decision). Keep the door open, see §6. |
| Farmer/provider updates | **Email.** |
| Tech stack | **Open — client has given us freedom.** Aim: best fit, lowest cost, free tiers where sensible. |
| The brief's mentions of `kodehut/terruvo`, Better Auth, Cloudflare, Twilio | Were tied to the old codebase. **Not binding now.** |

Because it's greenfield, "preserve working behaviour", "migration impact" and "existing-user transition" from the brief no longer apply.

---

## 2b. Build status (updated 27 Oct 2026)

**Built and tested:** the five provider access screens (Create account, Sign in, Forgot password, Email verification, Reset password) plus a placeholder `/provider/setup` page that only a verified, signed-in provider can open.

| Area | What exists |
|---|---|
| Stack in use | Next.js 16 (App Router, server actions), TypeScript, Better Auth, SQLite for local development (Postgres for production: one-line swap in `src/lib/auth.ts`), Geist font, plain CSS with design tokens |
| Accounts | Business name, +232 phone (normalised), email, password. Email must be confirmed with a **7-digit emailed code** before sign-in works. |
| Recovery | Forgot password → emailed 7-digit code → new password. Resetting revokes every other session. Responses never reveal whether an account exists. |
| Codes | Hashed at rest, expire after 10 minutes, 5 wrong tries, built-in rate limit on sends. |
| Email | One seam (`src/lib/email.ts`): Resend when `RESEND_API_KEY` is set; otherwise a dev outbox file. Refuses to send in production with no provider. |
| Tests | 9 browser tests (Playwright) pass: validation, verification, bypass attempts, unverified sign-in, neutral errors, password reset, other-browser sign-out, reset screen closed without a code, sign-up with JavaScript off. |
| Design match | Text widths and positions measured against the export and within about 1–3 px. Photos and logo are cropped from the export as stand-ins. |

**Not built yet (next):** provider setup overview and approval status, farmer sign-up/sign-in and farmer app, the provider workspace, payments. The outbox-with-retries pattern for email is still a TODO in `email.ts`.

**Assumed, not in the design (confirm):** error and success message styling, a hover colour for the button, "Already have an account?" and "New to Sagora?" links under the forms, "Verify" as the label on the code screen (the design repeats "Get verification code").

**Known gaps:** photos and logo should be replaced with the real Figma assets; colours are measured, not read from Figma variables; typography sizes are measured. The 38px/600 style supplied does not match anything on these five screens (title measures about 21px/600, subtitle 16px/400 and button label about 18px/500), so check which element it belongs to.

---

## 3. Scope

### In (V2)
1. **Verified accounts & provider onboarding** — email verification, recovery, sessions, roles, approval.
2. **Farmer requests** — guest intake (no account), assisted intake by coordinators, direct-provider links, district/service routing.
3. **Provider workspace** — Today, Requests & quotes, Schedule, Jobs, Equipment, Finance, Settings & team.
4. **Equipment register** — individual assets, condition, commitments, faults, history.
5. **Quotes, agreements, payments** — accept quote → pay → booking → delivery → settlement/refund.
6. **Staff screens** — provider approval, exceptions, coordinator follow-up.
7. **PDF invoices.**

### Services at launch
Ploughing and harvesting only (e.g. 4 acres ploughing in Bo; 5 hectares rice harvesting in Bombali).

### Out (first delivery)
Native mobile apps, AI features, new service categories, full accounting system, broad inventory system, public website rebuild, **SMS/OTP**. Later: maintenance, documents, spreadsheet import.

### Extensibility rule
Design data and components so **more services, equipment types, SMS, and other payment providers can be added later** — without building a workflow engine or plugin platform. No speculative features.

---

## 4. Non-negotiable rules (from the brief)

**Data & access**
- Providers are strictly isolated: Provider A can never read or act on Provider B. Enforced **on the server**, not just the UI.
- Private customer jobs block capacity but never become public leads.
- Staff access follows role and purpose; access to private customers/documents is authorised, time-limited and logged.
- Record **who changed what and when** on jobs, agreements and equipment.

**Requests & agreements**
- General requests go to eligible providers covering the district + service. **Direct requests stay with the chosen provider** — never silently converted.
- One job reference and one accepted agreement survive changes, faults, payments and refunds. A material change needs explicit agreement.
- Distinguish: requester, farmer, authorised representative, payer.

**Scheduling & equipment**
- Each physical asset has its own identity (two identical tractors stay distinct).
- Keep **separate**: condition, active/retired status, ownership, allocation authority, date availability.
- Overlapping commitments **must fail** (e.g. two tractors sharing one plough).
- A blocking fault flags affected jobs without erasing commitments. Retired assets stay readable but unselectable.
- An old inspection or empty calendar never proves readiness.

**Money**
- Amounts stored as **integer SLE minor units**. Balanced ledger entries; corrections by reversal, never edits.
- Keep distinct: payment status vs booking status; work reported vs farmer-confirmed delivery vs disputes vs payout vs refund. **Silence is not consent.**
- Booking is confirmed in **one database decision**: accepted terms + verified funds + machine, attachments and operator all free.
- Money arriving after a hold expired / capacity lost → create a "Payment received, booking not confirmed" case. Never overbook silently.
- Every money release: one **preparer** and a **different approver**. Changing amount/beneficiary invalidates approval.
- Duplicate or out-of-order payment events must not duplicate receipts, bookings or payouts (idempotency).

**Auth**
- Unverified accounts cannot enter setup or act, including via direct URLs/API calls.
- Verification/reset links expire, are single-use, and aren't consumed by email scanners (require a deliberate click to confirm).
- Neutral responses on recovery/resend (don't reveal whether an account exists). Rate limits.
- Password reset + "sign out all sessions"; revoked sessions fail on the next request.
- MFA for staff and finance, and before sensitive provider-owner money actions. Define lost-device recovery.
- Email confirmation and business approval are **separate** checks. Email alone never approves a business.

**UX**
- Specific states ("Awaiting farmer response", "Payment received, booking not confirmed") — never a vague "Pending".
- Farmer screens work on narrow phones, **without JavaScript**, and after connection failures. Assume shared phones, patchy data.
- Useful empty / loading / failed / expired / denied states. Respect reduced motion.

---

## 5. User journeys to support

| # | Journey | Failure cases to handle |
|---|---|---|
| 1 | Provider joins (signup → email confirm → setup → approval status) | Expired link, duplicate signup, invited teammate, missing approval info |
| 2 | Farmer requests work (intake → review → reference) | Interrupted submit, duplicate retry, unsuitable direct provider, no eligible provider |
| 3 | Provider quotes a job (tractor + plough + operator, price, dates) | Missing info, resource conflict |
| 4 | Farmer accepts & pays (accepted version, payment, booking) | Expired quote, failed payment, payment after capacity lost |
| 5 | Coordinator resolves a breakdown (replacement or refund) | No replacement, partial work, failed contact, disputed delivery |

**Reference stories**
- *Aminata* — 4 acres ploughing in Bo: name, farm, phone, chiefdom, town, dates, field conditions → provider quotes tractor + plough + operator → she accepts and pays → provider records readiness/work/quantity → she confirms delivery or raises a concern → settlement.
- *Assisted version* — coordinator records who called, whom they represent, who may accept the quote; shares the exact quote + farmer link; logs contact outcome and follow-up.
- *Harvesting* — 5 hectares of rice in Bombali; crop, dates, access conditions survive into the agreement; equipment must suit rice.

---

## 6. Decisions & proposed approach

### 6.1 Email-only communication (decided)
- Transactional email for: verification, password reset, request reference, quote-ready, booking confirmation, important changes, payment/refund confirmation.
- Use a **free-tier transactional email provider** on a Sagora-controlled sending domain (SPF/DKIM/DMARC). *Verify current free-tier limits before committing.*
- Keep a **notification outbox**: events are saved first, then sent with retries and duplicate protection. Saving a request/quote/payment must **never depend on email delivery**. Failed sends show in a staff queue with an owner.
- Notification code sits behind a `Notifier` interface with a `channel` field, so **SMS/WhatsApp can be added later as one adapter**.

### 6.2 Farmer request recovery without SMS (OPEN — needs Karim)
Options, simplest first:
1. Reference number + long unguessable, revocable link emailed at submission (links never logged).
2. Email one-time code, if the farmer gave an email.
3. Coordinator-assisted recovery (already required by the brief).

Many farmers may have no email → option 3 is the necessary fallback regardless.

### 6.3 Payments (OPEN — needs Karim)
"Sandbox" = a **test mode** offered by a payment provider (PSP), where you can simulate payments without real money. It isn't booking software. The brief names **Monime** as the PSP; we don't yet know its terms, fees or sandbox access.

Proposed phasing so payments never block the rest:
- **Phase A — manual/assisted payments:** coordinator/finance records an external payment (mobile money, bank, cash) with a receipt reference. Clearly labelled **"manual — not PSP-verified"**. Full ledger, booking, payout and refund logic is built and testable now.
- **Phase B — PSP integration:** add a `PaymentProvider` interface and one adapter (Monime if its terms work, otherwise another Sierra Leone-capable provider). Verified server-side via webhooks; browser success pages never count.
- Don't claim "escrow" unless the provider's terms support it.
- Live money only with approved terms, named finance owners and explicitly authorised capped tests.

### 6.4 Proposed tech stack (not final — confirm with Karim)
Chosen for low cost, Joseph's existing skills, and long-term maintainability:

| Layer | Proposal | Why |
|---|---|---|
| Language | TypeScript throughout | One language, strong typing for money/permissions logic |
| Framework | Next.js (App Router) | Known stack; server actions + forms work without JS when written as plain forms |
| Database | PostgreSQL (managed free tier, e.g. Neon or Supabase) | Real transactions/constraints are essential for booking, ledger and overlap prevention |
| ORM / migrations | Drizzle (or Prisma) | Typed queries, reviewable migrations |
| Auth | Better Auth (free, open source) | Email verification, sessions, roles, MFA plugins; matches the brief's original intent |
| Email | Free-tier provider (Resend / Brevo etc.) | Verify limits |
| PDF invoices | Server-side PDF library | Brief requires PDF invoices |
| Hosting | Cloudflare or a small VPS; **check each host's free-tier commercial-use terms** (some "hobby" tiers prohibit commercial use) | Keep costs near zero without breaching terms |
| Tests | Vitest (unit/integration), Playwright (E2E) | Brief demands browser E2E across roles |
| Repo | Git + GitHub, small PRs, CI (lint, types, tests) | Brief expects reviewed PRs and evidence |

**Alternative:** keep the brief's original Cloudflare Workers + D1 + Astro + React Router stack. It is cheap, but D1 (SQLite) is weaker for concurrent booking/ledger work, and it splits the app across two frameworks. I'd only choose it if Karim wants it.

### 6.5 Overlap prevention
Resource commitments (machine, attachment, operator) get a date range and are protected by a **database exclusion constraint** (Postgres) plus a transactional booking check, so two simultaneous bookings can't both succeed.

---

## 7. Proposed architecture (high level)

```
apps/
  web/            # Next.js: farmer pages, provider workspace, staff backoffice
packages/
  core/           # business rules (quotes, bookings, ledger, permissions) — no framework code
  db/             # schema, migrations, queries
  notifications/  # Notifier interface + email adapter + outbox worker
  payments/       # PaymentProvider interface + manual adapter (+ PSP adapter later)
  ui/             # shared components from the Figma design system
```
Route handlers and pages stay thin and call `core`.

### Main entities (draft)
User · Session · Provider business · Membership (role) · Operator (person, optional login) · Service · Equipment asset (machine/attachment, owned/leased, condition, status) · Fault · Request (guest / assisted / direct) · Contact (requester, farmer, representative, payer) · Quote (versioned) · Agreement (frozen accepted version) · Job · Resource commitment · Hold · Payment · Ledger entry · Payout · Refund · Dispute · Case/Exception · Audit log · Notification outbox.

---

## 8. Delivery stages

| Stage | Deliverable | Done when |
|---|---|---|
| 0 | **Foundation:** repo, CI, environments, DB schema v1, design tokens | App deploys; tests run in CI |
| 1 | **Access:** signup, email verification, sign-in, reset, sessions, roles, invites, provider setup + approval, MFA for staff | Bypass attempts fail; old sessions die after reset; cross-provider access blocked |
| 2 | **Farmer intake & routing:** guest + assisted requests, direct/general routing, reference + recovery link, email updates, failed-email queue | Request survives email outage; routing correct |
| 3 | **Provider operations:** Today, requests/quotes, schedule, private jobs, equipment register, faults | Overlapping commitments fail; asset history intact; usable on phone |
| 4 | **Paid job (ploughing):** quote acceptance, manual payments → booking, work report, confirmation, settlement, refund, reconciliation; then PSP adapter | Duplicate events harmless; late payment becomes a case |
| 5 | **Harvesting** + remaining polish | Same full journey for rice harvest |

Each stage: estimate → implement in small PRs → demo to Karim → sign-off before the next.

---

## 9. Design references (Figma)

File: `https://www.figma.com/design/IKwl7vv57oLfLvW7l9afBB/Sagora`

**The design is a source of truth.** Where it differs from the brief, the design wins unless Karim says otherwise (see "Design vs brief" below).

The 17 shared links are *sections* (each holds several screens/states, ~60+ frames in total). Desktop frames are 1728×1117. Access via the Figma connector works, but it is rate-limited (see "Status").

Two apps share one visual system and shell (left sidebar + top bar with search, notifications, avatar):

- **Provider app** sidebar: Dashboard · Requests · My quotes · Jobs · Equipment · Payments · Notifications · Team · Reports; Personal: General settings · Help & support · Account · Logout.
- **Farmer app** sidebar: Home · Book a service · My requests · My bookings · Payments · Notifications; Personal: same as above.

| Node | Section | App | Frames / states found | Stage |
|---|---|---|---|---|
| `1-2506` | Home | Provider | Dashboard; "Home-tractors" variant | 3 |
| `1-2507` | Farmers (Home) | Farmer | Home: greeting, Book ploughing / Book harvesting, "How it works", recent requests table (4 frames) | 2 |
| `11-31` | Equipments | Provider | 7 frames (list and equipment states) | 3 |
| `15-6284` | Requests | Provider | Request list, filters (service / district / date) (4 frames) | 3 |
| `15-8170` | Quotes | Provider | "My quotes" (2 frames) | 3 |
| `15-9385` | Jobs | Provider | "My jobs" (2 frames) | 3 |
| `15-10667` | Payments | Provider | Payments, payment method, **Monime setup**, **OTP**, payment confirmation, submitted, details (9 frames) | 4 |
| `21-16070` | My requests | Farmer | Request list and request flow states (9 frames) | 2 |
| `30-19534` | Bookings | Farmer | Bookings list with status tabs (Upcoming / In progress / Completed / Cancelled), empty state (5 frames) | 4 |
| `32-21589` | Payments | Farmer | Transactions table (Transaction ID, Type, Amount in "Le", Date, Status), empty state (5 frames) | 4 |
| `35-23756` | Notifications | Provider | Notification list with Filter | 2 |
| `35-25885` | Notifications | Farmer | Same pattern as provider | 2 |
| `40-27140` | Settings | Provider | Settings, Business details, Account, Logout (5 frames) | 1–3 |
| `59-2686` | Sign up / Sign in | Farmer | Create account, Sign in, Forgot password (email), Email verification (7-digit OTP), Reset password | 1 |
| `48-27366` | Team | Provider | Team management table; invite modal; edit modal (3 frames) | 3 |
| `55-515` | Settings | Farmer | Settings home; Account; Reset-password modal (×2); Logout confirm (5 frames) | 2 |
| `57-1815` | Providers – Sign up / sign in | Provider | Create account, Sign in, Forgot password, Email verification, Reset password (5 frames) | 1 |

### Status
- Structure and all on-screen text read for **all 17 sections** (about 65 frames). **Not yet pulled:** visual detail (colours, type, spacing, assets) via per-screen design context. Needed before building any screen to pixel level.
- The connector is limited by the Figma seat (View seat on a Professional plan). A Dev/Full seat or exported frames (PNG/PDF + design tokens) removes the blocker.

### Screens seen in exported images (low resolution — verify against Figma before building)
- **Provider Requests** (matches `15-6284`): table (Request, Service, Location, Farm size, Preferred date, Status) with pagination; status chips Quotes sent / In progress / Cancelled / Completed; filters for service (Ploughing, Harvesting), district (Bombali, Kono, Kenema) and date; a **request detail modal** (e.g. SG-1047) with tabs *Request details / My quotes / Activity*, fields Service type, Farm size, Preferred date, Alternate date, District, Community/Village, Additional information, and actions **Close / Send a quote**.
- **Settings** (matches `40-27140`): Settings home with *Account* and *Password and security*; Account form (full name, phone number, email address; Close / Save changes); **Reset your password** modal (password, confirm password, show/hide; Close / Save new password); **Logout** confirmation (Cancel / Logout).
- **Team management** (new — one of the 3 unread sections; node ID to confirm): table (Name, Role, Permissions, Status) with a row menu; roles seen: Owner, Operator, Assistant; permissions seen: Full access, Manage jobs, View jobs; status Active. **Invite team member** modal: full name, phone number (+232), email, role, permissions; Cancel / Send invitation. **Edit team member** modal: same fields; Cancel / Save changes. This fits the brief (invited teammates join the business with assigned permissions; operators are people and need not all have logins).

### Provider sign-up / sign-in (from exported image — all 17 layers now accounted for)
Five screens, same split layout as the farmer ones: form on the left (logo, title, subtitle, fields, green pill button), rounded photo on the right (garden watering, market basket, harvester).
1. **Create a provider account:** Business name, Your phone number (+232 00 000 000), Email, Password (show/hide, "At least 8 characters"), button *Create account*. Subtitle reads "Enter your email address to continue" although the form has four fields — copy to tidy.
2. **Welcome back (sign in):** Email, Password (show/hide), "Forgot password? Click here", button *Sign in*.
3. **Forgot password:** Email, button *Get verification code* ("one-time verification code").
4. **Email verification:** 7-box code input, "Didn't get any code? Resend code", button *Get verification code* (label looks copied; should likely be *Verify*).
5. **Reset password:** Password, Confirm password, button *Reset password*.

Farmer sign-up differs only in the first field (**First and last name** instead of Business name). The farmer sign-up title says "Create a provider account", so that title is a copy slip.

### Settings (both apps, from exported images)
- **Farmer Settings:** home with *Account* and *Password and security*; Account form (full name, phone, email; Close / Save changes); Reset-password modal; Logout confirmation.
- **Provider Settings** (`40-27140`): home with *Business details*, *Team*, *Account*, *Password and security*; Business details form (business name, phone, email, plus extra fields and an info box; Close / Save changes); Account; Reset-password modal; Logout confirmation.

### Design tokens measured from the provider sign-in export
Sampled from pixels in the exported JPG (about ±2 per colour channel because of JPEG compression). **Provisional until the real Figma variables are pulled.** The export is at 3× the design size.

| Token | Value | Where |
|---|---|---|
| Page background | `#F7F8F2` | Whole page, left panel |
| Brand green | `#567621` | Primary button, logo mark |
| Input fill | `#FFFFFF` | Text fields |
| Input border | about `#EEF0E2`, 1px | Text fields (very subtle) |
| Heading text | `#000000` | Titles, field labels, button label on light |
| Subtitle text | `#636361` | Subtitle under the title |
| Placeholder text | `#7F7F7F` | Placeholder and helper text |
| Icon grey | `#7F7F7D` | Show/hide password eye |
| Button label | `#FFFFFF` | On the green button |

Layout (design pixels, 1728×1117 frame): form column 436 wide; text fields 50 tall; primary button 55 tall, fully rounded pill; vertical gap between fields about 22; logo mark about 70×65; right-hand photo panel about 809×1059 with large rounded corners. Typeface not identified from pixels — check in Figma.

### Design vs brief (to confirm with Karim)
1. **Farmer accounts.** The designs include farmer sign-up/sign-in, "My requests", "My bookings", farmer payments. The brief says farmers request *without* an account (guest intake). Likely: accounts optional, guest path kept. Confirm.
2. **Email OTP.** Forgot-password uses a **7-digit email code**, plus a "Payments – OTP" screen on the provider side. So email OTP is in the design. The brief's SMS-OTP is dropped, but email OTP is now required for password reset and probably payout confirmation. Confirm what the Payments OTP protects.
3. **Monime.** The provider "Monime setup" screen confirms Monime as the payout/collection provider in the design. Still need sandbox access and terms (§6.3).
4. **Navigation.** Design has Team and Reports; brief puts Reports later. Design has no Today or Schedule screens; the brief requires a schedule with conflict checks. Ask whether Schedule lives inside Jobs/Equipment or is missing.
5. **Copy slip.** The farmer sign-up screen says "Create a provider account" — probably a copy error in the design.
6. **Currency.** Amounts show as "Le 2,500" (Sierra Leone leone). Store as integer minor units (§4).
7. **Scale.** 17 sections ≈ 60+ screens/states. Build section by section inside the stages in §8.

---

## 10. Open questions for Karim

1. Is the stack truly open, and is the proposed one in §6.4 acceptable?
2. Farmer request recovery without SMS — which option(s) in §6.2?
3. Payments — OK to start with manual/assisted payments (Phase A)? Who is the PSP and can we get test access? Approved policy sheet needed for: 10% pilot fee (none for first 20 jobs), advance rules (after 2 clean jobs, capped at fuel/transport), 5-working-day refund deadline, 90-day write-off. The 5% retention stays excluded until approved.
4. Hold / quote / payment expiry rules.
5. Provider and asset verification evidence; who approves; how often checks expire.
6. Who owns each failure queue (failed emails, payment exceptions, refunds)?
7. Who pays for hosting / email / domain, and who holds the accounts? (Brief says domains and service accounts stay under company control.)
8. Estimate and dates are agreed with Karim **before** build starts (brief requirement).

---

## 11. Working agreements

- Small PRs; each links to the stage and acceptance scenario it serves.
- No secrets in the repo or docs. Use env vars; document config without credentials.
- Never use real customers or production funds as test data. Use anonymised fixtures.
- Every release: lint, types, build, unit + DB integration tests, browser E2E across roles; record revision, environment, result.
- Update this file when a decision changes.

---

## 12. Acceptance scenarios (summary)

Verification can't be bypassed · setup resumes after verify · invites join the right business · reset kills old sessions · Provider A can't touch Provider B · only authorised staff approve providers · guest/assisted intake preserves details · routing is correct (general vs direct) · request survives email outage with a visible follow-up · quote matches accepted version · shared plough/operator can't double-book · duplicate payment events don't duplicate money · late payment creates an exception · breakdown leads to replacement or refund with history intact · payout needs separate preparer/approver · two identical assets stay distinct · retired equipment unselectable · provider completes setup, quote, private job, conflict check and machine history **without coaching** on desktop and narrow phone.

---

## Build status update (27 Oct 2026, evening): provider setup and approval

**Built and tested (14 browser tests pass):**
- `/provider/setup`: business details form (name, phone, email, district, town, services, about). "Save for later" keeps a draft; "Submit for review" validates everything. Pre-filled from sign-up.
- Review states shown in plain words: *Waiting for Sagora to review*, *Sagora needs a few changes* (with the staff note), *Approved*, *Rejected*. A submitted business cannot be edited.
- `/staff/providers`: staff-only queue with Approve / Ask for changes / Reject. A note is required unless approving. The provider gets an email with the result. Every decision is written to `audit_log`.
- Staff are made by an operator with database access: `npm run staff:make -- email`. There is no public route to staff.
- Rules kept: a provider only ever reaches their own business (looked up by session, never by a form value); email confirmation and business approval are separate steps; a double-clicked decision does nothing.

**No Figma frame exists for setup or approval.** The look follows the Settings > Business details form plus the auth tokens. Needs the designer's real screens.

**Still missing for stage 1:** MFA for staff (the staff screen is protected by role and verified email only, so do not use it with real data until MFA is added), invited teammates joining the right business, equipment and verification evidence in setup.
