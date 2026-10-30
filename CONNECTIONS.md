# Connection checks

What has actually been proven to work, as opposed to described. No secrets in this file.
Last run 30 Oct 2026, from Joseph's machine.

| Service | Result | Evidence |
|---|---|---|
| **Neon** | Works | `npm run db:migrate` prints `postgres ...neon.tech/neondb`. Sign-in tables and schema were **already up to date** (1 migration applied), so production had been migrated before this check |
| **Vercel site** | Works from outside | No 500s. Sign-in, sign-up and recovery pages return 200, guarded pages redirect to sign-in, `/api/auth/get-session` returns 200, no console errors |
| **Vercel** | Works, **email is not configured** | `vercel whoami` is `josephbusayo`. Project `sagora` under scope `josephbusayos-projects`, linked here. Hobby keeps runtime logs for about 1 hour. The last 30 minutes hold only the harmless `sslmode` warning, filed at error level. Production holds four variables: `BETTER_AUTH_SECRET`, `CENTRAL_LICENSE_KEY`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`. **`RESEND_API_KEY`, `SAGORA_ENV` and `BETTER_AUTH_URL` are missing** |
| **DNS** | **Not landed** | `resend._domainkey.sagora.sl`, `rsend.sagora.sl`, `send.sagora.sl` and `_dmarc.sagora.sl` are all NXDOMAIN, including from `ns1.netim.net` itself, so this is not propagation delay. `sagora.sl` TXT holds only an SPF record for `ip4:185.26.104.0/22`, which does not include Resend |
| **Figma** | Works | File `LiwlNONIHcNE1Il3V8pReB` reads through the connector on Joseph's Full seat. The separate `plugin:figma:figma` server still asks for authorisation and was not needed |

## What is actually broken on the deployment

**Nobody can finish signing up.** With no `RESEND_API_KEY`, `sendEmail` throws in production, so the
verification code never leaves and the account stays unverified. No page shows an error. This
machine has no Resend key either: `.env.local` does not contain one, so `npm run vercel:env`
cannot supply it.

Production data: one verified farmer, created 04:47 UTC, before any Vercel variable existed, so
it came from local development against Neon, not from the deployed site. Staff, providers and
requests are empty.

## What blocks a full walk on the deployed site

- **No mail at all** until `RESEND_API_KEY` is set in Vercel and the site redeployed.
- **Then one inbox.** Until the DNS records land, mail can only reach the address the Resend account
  was registered with. The walk needs a farmer, a provider and a staff account on different
  emails, and each needs a code by email; staff need one at every sign-in.
- **Accounts are made by a person.** Sign-ups and passwords on the live site are entered by
  Joseph, not by an agent. `npm run staff:make -- <email>` can follow once the account exists.

## Traps found

- `vercel link` writes `VERCEL_OIDC_TOKEN` into `.env.local`. The other values are untouched.
- Vercel's CLI suggests scope `kpcrashouts-projects`. Sagora is not there: use `josephbusayos-projects`.
- Playwright's browser must be installed once per machine: `npx playwright install chromium`.
- `.env.local` holds the production `DATABASE_URL`. `npm run dev`, and anything else that loads
  it, runs **on production data**. `test:e2e` and `smoke` used to as well; they now blank the
  variable unless it is set in the shell. `check:money` never loaded the file.
- `npm run db:reset` is only stopped by `SAGORA_ENV=production`, which is not in `.env.local`.
  `--yes` from this machine would empty production.

## Corrections to the docs

- `SERVICES.md` looked missing because local `main` was one commit behind `origin/main`.
- The note that production "has probably never been migrated" was wrong.
- The sidebar logo is not the sprout: it is a separate 108x28 wordmark, node `465:14559`.
- The booking flow's frames are `465:11158` and `465:11454` in the Farmers section, not the
  "Edit details" modals in My requests.

## Figma limit, hit 30 Oct 2026

The file is on the Starter plan, whose MCP connector has a call limit. It ran out after about 25
calls in one session, so "Figma access is solved" is only true for light use. When it says
"tool call limit", new frames cannot be read until it resets or the plan is upgraded. Plan frame
reads rather than exploring: `get_metadata` on a section is one call and holds all its text.

## Update, 30 Oct 2026, 12:45

Vercel deploys production from `main`, and previews from other branches. `RESEND_API_KEY` and
`SAGORA_ENV` are now set, migrations 002-004 are on Neon, and `7ccf44d` is live. Sending email
from the deployed site has not been proven yet: that needs a real sign-up. This replaces the
"email is not configured" notes above.

Email from the deployed site is **not** proven. An earlier note here said it was, on a mistaken
report. What the database shows, 30 Oct 2026:

- A provider sign-up to another Gmail address was rejected by Resend with a 403. That is what
  Resend's shared sender does for any address but the account's own, though the code discards
  the response body, so the reason is inferred.
- No staff code was ever queued. No session has been created since 09:03 and `staff_mfa` is
  empty, so the staff sign-in never succeeded and `/staff/verify` was never reached.
- `signIn` reports every failure as "Incorrect email or password", including database errors.
- Vercel logged Better Auth's "Could not validate the database schema" at 11:53 on
  `/provider/sign-in`. That check runs in the background and does not itself stop a sign-in.

**Root cause of the missing staff code, found 30 Oct 2026.** The staff sign-in did work at 12:07
and queued its code, but the row stayed at `attempts: 0`. `notify` started sending with
`void drain()`, and Vercel freezes a function once the response is sent. `waitUntil` fixes it.
Nothing drains the queue on a timer, so a failed send also waits for the next event.

**Email proven, 30 Oct 2026, 15:58 UTC.** After `d24aaa5` the staff code was sent and entered, and
the staff session is verified. The queue also shows the retry to the second Gmail address accepted
by Resend, after its earlier 403. So the "one inbox" limit above may not hold: confirm by checking
whether that address actually receives mail. The cause of the first 403 is unknown.

**The 403 explained, 30 Oct 2026.** Resend's own message: testing emails can only go to the
account's own address, `josephbusayojayeoba@gmail.com`, until a domain is verified. So the key is
good and the "one inbox" limit stands. The earlier "sent" on a retry to the other Gmail is
unexplained. Reading login codes out of the production queue is blocked for agents.
