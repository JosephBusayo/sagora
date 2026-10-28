# Waiting on

Everything the build needs from someone else. Stand-ins are in place so nothing is blocked;
each one is a swap, not a rewrite. Updated 28 Oct 2026.

## From the designer

| # | What | Where it bites | Stand-in in use |
|---|---|---|---|
| 1 | **Sagora logo, as SVG** | Sidebar, all auth screens | Hand-drawn asterisk — the only hand-drawn graphic left |
| 2 | **Icon corner radius** (1, 2 or 3) | Every icon | Radius 2. Round/filled/stroke-2 are confirmed by measurement; the radius cannot be read from a 22px export |
| 3 | **Auth photos** for the farmer frames (`59-2686`) | Farmer sign-up, sign-in, verify, reset | Provider photos, cropped from the one export |
| 4 | **Real asset exports** for the provider auth photos | Provider auth screens | Crops of `sign_in.jpg` |
| 5 | **Farmer app frames** (`1-2507`, `21-16070`) at usable resolution | Farmer home, Book a service, My requests | Built from layer names plus the shared design system |
| 5b | **My quotes frames** (`15-8170`) | Provider quote form, My quotes table, farmer quote cards | Built in the design system's language, not from a frame |
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
| 2 | **Monime sandbox access and terms** | Blocks all of stage 4 (payments). Quotes can now be accepted, but nothing can be paid for |
| 3 | **A Monime account in his own name** | It holds his money and his KYC. It must never be in the developer's name |
| 4 | **The domain, registered in his name** | Moving a domain between owners is slow and avoidable |
| 5 | **Farmer request recovery without SMS** (§6.2) | Many farmers have no email. Open question in the brief, and it changes the intake design |
| 6 | **Stack confirmation** | Section 10 decisions are still unconfirmed. Nothing is blocked, but he should know what is being built |
| 7 | **Who approves providers, and against what evidence** | The approval screen works; the policy behind it is undefined |

## From Joseph

| # | What |
|---|---|
| 1 | **Central Icons licence key on every build machine** — CI and the deploy host, not just the laptop. `npm install` fails without it |
| 2 | **Confirm the five remaining sidebar sections** are wanted as designed — Dashboard, Jobs, Equipment, Payments, Reports |

## Known gaps in the build itself

Not waiting on anyone; just not written yet.

- **MFA for staff and money actions** — a brief requirement. Until it exists, do not put real data behind the staff screen.
- **Changing a sign-in email** — needs re-verification; no design exists.
- **Email outbox with retries** — a TODO in `email.ts`. The brief requires a request to survive an email outage.
- **SQL migration files** — the schema is still `CREATE TABLE IF NOT EXISTS` in `db.ts`. Must become numbered migrations before Postgres.
