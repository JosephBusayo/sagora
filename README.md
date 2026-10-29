# Sagora 2.0

Agricultural service platform for Sierra Leone. Read **PROJECT.md** first: it is the source of truth for scope, rules, decisions and build status.
**HANDOVER.md** covers accounts and how the project moves to the client.
**WAITING-ON.md** lists everything the build needs from the designer, the client and you.

## Requirements

**Node 22.5 or newer** (`node -v`). Nothing compiles: no Python, no Visual Studio build tools.
The local database uses Node's own built-in SQLite, so `npm install` is the same on Windows,
macOS and Linux.

**A Central Icons licence key.** The icon packages check it during installation, so
`npm install` fails without it. Set it before installing, on every machine that builds the
project — your laptop, CI, and the deploy host:

```bash
# macOS / Linux
export CENTRAL_LICENSE_KEY=your-key
# Windows PowerShell
$env:CENTRAL_LICENSE_KEY="your-key"
```

## Run it locally

**Windows (Command Prompt):**

```
npm install
copy .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste that value after `BETTER_AUTH_SECRET=` in `.env.local`, then:

```
npm run db:migrate
npm run dev
```

**macOS / Linux:**

```bash
npm install
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # paste into .env.local
npm run db:migrate
npm run dev
```

`db:migrate` creates the SQLite database in `./data` and applies everything in `/migrations`.
`dev` serves <http://localhost:3000>, which opens on the provider sign-in screen.

With no `RESEND_API_KEY`, emails are not sent. They are written to `data/dev-outbox.jsonl`, which is where you read verification codes while developing:

```bash
tail -n 1 data/dev-outbox.jsonl
```

On Windows (cmd), open `data\dev-outbox.jsonl` in Notepad, or:

```
powershell -Command "Get-Content data\dev-outbox.jsonl -Tail 1"
```

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm run test:e2e                # builds first, then runs 86 browser tests on a throwaway database
npm run check:money             # 47 checks of the money rules, no browser, ~10 seconds
```

## See the whole thing in a browser

Everything below runs on your machine with no accounts or keys.

```bash
npm run dev
```

1. Open http://localhost:3000 and create a provider account.
2. Read the 7-digit code: `tail -n 1 data/dev-outbox.jsonl`
3. Fill in the setup form and submit it for review.
4. Approve yourself, so you can reach the workspace:

```bash
npm run dev:approve -- your@email.com
```

5. Sign in again. You now get the sidebar, **Settings** and **Team management**.
6. Invite a teammate from Team. The invitation link is in `data/dev-outbox.jsonl`; open it in a private window to accept it.

To use the real staff review screen instead of step 4, make a second account and run
`npm run staff:make -- staff@email.com`, then sign in with it to reach `/staff/providers`,
`/staff/payments` (the finance desk) and `/staff/outbox` (failed notifications).

Signing in is not enough: staff screens ask for a 7-digit code emailed to the staff account. In
development that email lands in `data/dev-outbox.jsonl` — open it and read the last line.

Money out needs **two different staff accounts**: one prepares a payout or refund, a different one
approves it. Make two if you want to walk that through.

## Smoke run

```bash
npm run smoke
```

One command: builds the app, starts it on port 3200 with a throwaway database, drives the whole
product through a browser, then stops. It is the walkthrough you would do by hand — farmer signs
up, books work, provider signs up, staff approves them, provider quotes, farmer accepts.

Each step prints OK or FAIL; a failure saves a screenshot to a `sagora-smoke` folder in your system temp directory. It refuses to run if something is already using port 3200, rather than driving the
wrong server.

## Changing the database schema

The schema lives in `migrations/`, as numbered SQL files. Nothing creates tables at runtime.

To change it, add the next numbered file — never edit one that has already run. The runner
records a checksum of every file it applies and refuses to continue if one of them changes,
because two databases that claim the same version must be the same shape.

```
migrations/002_add_whatever.sql     # then:
npm run db:migrate
```

The files are written so both SQLite (today) and PostgreSQL (later) accept them.

## Where things live

| Path | What |
|---|---|
| `src/app/provider/*` | Provider access screens and `actions.ts` (server actions) |
| `src/app/provider/(app)/*` | The signed-in workspace: sidebar sections, Settings, Team |
| `src/app/staff/*` | Sagora staff screens (provider review) |
| `src/components/app/*` | Shell: sidebar, top bar, icons, shared forms |
| `src/lib/business.ts` | Business record, review states, audit log |
| `src/lib/team.ts` | Team members, invitations, permissions |
| `src/lib/guard.ts` | One gate for every workspace page |
| `src/components/auth/*` | Shared form pieces (fields, code input, buttons) |
| `src/lib/auth.ts` | Better Auth setup (email + password, emailed codes) |
| `migrations/*.sql` | The schema, as numbered files. The only place tables are created |
| `src/lib/migrate.ts` | Applies them in order, once each, and refuses an edited one |
| `src/lib/db.ts` | The database connection (Node built-in SQLite). Swap here for Postgres |
| `src/lib/email.ts` | The single place that sends email |
| `src/components/app/Icon.tsx` | The icon set. One place maps names to Central Icons |
| `src/app/globals.css` | Design tokens and styles |
| `e2e/` | Browser tests |
