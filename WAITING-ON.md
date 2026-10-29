# Waiting on

Everything the build needs from someone else. Stand-ins are in place so nothing is blocked;
each one is a swap, not a rewrite. Updated 29 Oct 2026.

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
