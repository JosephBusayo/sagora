# External services

Every service Sagora touches, what identifies it, and how to connect. Updated 30 Oct 2026.

**No secrets in this file.** Project ids, org ids and file keys are not secrets and live here.
Connection strings, API keys and licence keys live in `.env.local` (gitignored) and in the
host's environment settings, and belong in neither a commit nor a chat window.

| Service | What it is | Identifier | Whose account |
|---|---|---|---|
| **Neon** | PostgreSQL | project `summer-cell-85093947`, org `org-floral-base-36768715`, branch `production`, region `aws-eu-west-2` | Joseph |
| **Vercel** | Hosting | `sagora-three.vercel.app` | Joseph |
| **GitHub** | Repository | `JosephBusayo/sagora` (client copy: `sagorasl/sagora`) | Joseph |
| **Netim** | Domain registrar | `sagora.sl`, nameservers `ns1/ns2/ns3.netim.net` | **Karim / Kodehut** |
| **Resend** | Outgoing email | domain `sagora.sl` pending verification | Joseph |
| **Figma** | The design | file `LiwlNONIHcNE1Il3V8pReB` (Joseph's copy) | Joseph |
| **Central Icons** | Icon set | `@central-icons-react/round-filled-radius-2-stroke-2` | licensed |
| **Monime** | Mobile money | not opened | must be Karim's |

## Connecting each

**Neon** — `npm i -g neon@latest`, then `neon login`, then
`neon env pull --project-id summer-cell-85093947`. That writes `DATABASE_URL` (pooled, for the
app) and `DATABASE_URL_UNPOOLED` (direct, for migrations) into `.env.local`. Schema changes
must use the direct one or they fail in ways that never mention pooling.

**Vercel** — `npm i -g vercel@latest`, `vercel login`, `vercel link`, then
`npm run vercel:env` to push the production environment from `.env.local`. `vercel --prod`
deploys. `CENTRAL_LICENSE_KEY` must be set in Vercel before the first deploy or `npm install`
fails during the build, before any of this project's code runs.

**Figma** — the MCP connector, against file `LiwlNONIHcNE1Il3V8pReB`. `get_metadata` on the
canvas returns every section's node tree and text in one call; `get_design_context` on a frame
returns resolved colours, type, spacing and shadows. The original file is on a team where
Joseph holds a View seat, which is rate-limited after a couple of calls — always use the copy.

Section node ids in that file: Home `465:64`, Providers auth `465:719`, Farmers auth
`465:918`, Requests `465:1117`, Quotes `465:2328`, Jobs `465:2974`, Equipments `465:3605`,
Payments (provider) `465:6229`, Notifications (provider) `465:8139`, Settings (provider)
`465:8347`, Settings (farmer) `465:9168`, Team `465:9990`, Farmers home `465:10713`, Bookings
`465:11716`, Payments (farmer) `465:12755`, Notifications (farmer) `465:13809`, My requests
`465:14000`.

**Resend** — an API key works immediately; sending from `@sagora.sl` needs the DNS records
below to verify first. With `EMAIL_FROM` unset the code falls back to Resend's own sender,
which delivers **only to the address the Resend account was registered with**.

**Netim** — DNS records are under the domain's **Zone file**, not Nameservers. Records are
submitted as operations and applied asynchronously; watch the **Operations center** for their
status. A record that does not appear in the zone list is not saved, however the dialog looked.

**Central Icons** — `CENTRAL_LICENSE_KEY` must be in the environment of every machine that
runs `npm install`, including the deploy host. A `preinstall` hook checks it against
centralicons.com and fails the install without it.

## The design is the source of truth

Where the design differs from the brief, the design wins unless Karim says otherwise. Its copy
is the designer's decision, not a suggestion — a screen rewritten in our own words reads fine
and is not the product that was drawn.

Four things in the file look like copy-paste slips rather than decisions, and are deliberately
not copied. Each is worth one message to the designer:

- the farmer sign-up titled "Create a provider account"
- the farmer settings subtitle offering to manage a business and a team a farmer does not have
- the farmer payments subtitle promising earnings and payout details
- "Paymentd" in the provider sidebar, and "Harvest your crups efficiently" on farmer home

## Still to get

- The **Sagora logo as SVG**. The sidebar mark is still hand-drawn — the last hand-drawn
  graphic in the build. It can now be downloaded from the Figma copy.
- **Monime**, from Karim. Payments are recorded by hand by design, so nothing is blocked on it.
- **Production hosting** in Karim's name. Vercel's Hobby plan forbids commercial use, so the
  current deployment is a staging arrangement, not where this ends up.
