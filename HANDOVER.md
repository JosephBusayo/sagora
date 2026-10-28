# Handover

Sagora is being built on the developer's own accounts. Everything here exists so the whole
project can be moved to the client without a rebuild, a migration project, or a hunt for
credentials.

**The rule:** nothing we depend on may be impossible to replace. Every external service is
reached through one file, configured by one environment variable, and holds no logic of its own.

---

## Accounts

| Service | What it does | Held by | How it moves |
|---|---|---|---|
| GitHub | The code | Developer | Transfer the repository, or move it to a Sagora organisation now and change owners later |
| Postgres host (not chosen yet) | The database | Developer | Transfer the project to the client's account, or hand over the database with `pg_dump` |
| Resend | Sends email | Developer | New account, new API key, change one environment variable |
| Vercel (planned) | Hosting | Developer | Transfer the project, or redeploy from the same repository anywhere that runs Node |
| Monime | Payments | **Client** | Must be the client's own account from day one: it holds their money and their KYC |
| Domain | Web address | **Client** | Register in the client's name. Moving a domain between owners is slow and avoidable |

Two of these should never be in the developer's name: **payments and the domain**. Everything
else is safe to hold temporarily because it can be replaced in minutes.

Use a dedicated email address for every service account, not a personal one, so the whole set
can be handed over together. The client's own domain address is better still.

---

## What keeps us portable

**The database is plain Postgres.** Whichever host we end up on is used as a Postgres host and
nothing more. No vendor's own auth, no Row Level Security as an access-control layer, no vendor
storage or serverless functions. Sign-in is Better Auth, in our own code (`src/lib/auth.ts`), and
all database access goes through the server. The practical effect: moving between Supabase, Neon,
Railway, AWS or the client's own server is a `pg_dump`, a restore, and one changed connection
string. No vendor's name appears anywhere in the application.

**Every external service sits behind one file.**

| Service | The only file that talks to it |
|---|---|
| Database | `src/lib/db.ts` |
| Email | `src/lib/email.ts` |
| Sign-in and sessions | `src/lib/auth.ts` |
| Payments (planned) | `src/lib/payments.ts` |

Swapping a provider means rewriting one file, not searching the codebase.

**All configuration is environment variables.** No key, URL or account name is written into the
code. `.env.example` lists every variable the project needs, with a comment saying what it is
for. A new owner can read that file and know exactly which accounts they must create.

**No secrets in the repository.** `.env.local` is git-ignored. Keys are rotated at handover
anyway, so a leaked old key cannot be used.

---

## Handover checklist

1. Transfer the GitHub repository to the client.
2. Transfer the Supabase project, or dump and restore into their own account.
3. Transfer or redeploy the hosting project.
4. Create new API keys on the client's accounts for email and payments, and **revoke the old ones**.
5. Point the domain at the new deployment.
6. Hand over `PROJECT.md` (what the system does and why), this file, and the list of environment variables.
7. Delete the developer's copies of the production credentials.

Step 4 matters most. Access should end at handover, not drift on indefinitely.

---

## Known gap

The database schema is still created by `CREATE TABLE IF NOT EXISTS` statements in `src/lib/db.ts`.
Before the move to Postgres this becomes numbered `.sql` migration files in the repository, so the
schema can be rebuilt from scratch on any Postgres server and every change is reviewable in Git.
