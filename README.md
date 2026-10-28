# Sagora 2.0

Agricultural service platform for Sierra Leone. Read **PROJECT.md** first: it is the source of truth for scope, rules, decisions and build status.

## Requirements

**Node 22.5 or newer** (`node -v`). Nothing else: no Python, no Visual Studio build tools,
no compiler. The local database uses Node's own built-in SQLite, so `npm install` is the
same on Windows, macOS and Linux.

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
| `src/app/globals.css` | Design tokens and styles |
| `e2e/` | Browser tests |
