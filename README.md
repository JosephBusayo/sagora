# Sagora 2.0

Agricultural service platform for Sierra Leone. Read **PROJECT.md** first: it is the source of truth for scope, rules, decisions and build status.

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
npm run test:e2e                # needs a prior `npm run build`; uses a throwaway database
```

## Where things live

| Path | What |
|---|---|
| `src/app/provider/*` | Provider access screens and `actions.ts` (server actions) |
| `src/components/auth/*` | Shared form pieces (fields, code input, buttons) |
| `src/lib/auth.ts` | Better Auth setup (email + password, emailed codes) |
| `src/lib/email.ts` | The single place that sends email |
| `src/app/globals.css` | Design tokens and styles |
| `e2e/` | Browser tests |
