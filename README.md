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

```bash
npm install
cp .env.example .env.local      # then set BETTER_AUTH_SECRET (openssl rand -hex 32)
npm run db:migrate              # creates the local SQLite database in ./data
npm run dev                     # http://localhost:3000  -> provider sign-in
```

With no `RESEND_API_KEY`, emails are not sent. They are written to `data/dev-outbox.jsonl`, which is where you read verification codes while developing:

```bash
tail -n 1 data/dev-outbox.jsonl
```

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm run test:e2e                # builds first, then runs 20 browser tests on a throwaway database
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
`npm run staff:make -- staff@email.com`, then sign in with it to reach `/staff/providers`.

## Smoke run

A scripted walkthrough of the whole product against a real server, with a fresh database.
It is the walk-through you would do by hand: farmer signs up, books work, provider signs up,
staff approves them, provider quotes, farmer accepts.

```bash
npm run build
DATABASE_PATH=data/smoke.db npm run db:migrate
DATABASE_PATH=data/smoke.db BETTER_AUTH_URL=http://localhost:3200 \
  BETTER_AUTH_SECRET=smoke-secret-smoke-secret-smoke-1234 SAGORA_TEST_OUTBOX=1 \
  npx next start -p 3200 &
npm run smoke
```

Each step prints OK or FAIL; a failure saves a screenshot to `/tmp/smoke`.

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
| `src/lib/db.ts` | The local database (Node built-in SQLite). Swap here for Postgres |
| `src/lib/email.ts` | The single place that sends email |
| `src/components/app/Icon.tsx` | The icon set. One place maps names to Central Icons |
| `src/app/globals.css` | Design tokens and styles |
| `e2e/` | Browser tests |
