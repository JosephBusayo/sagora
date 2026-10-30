/**
 * Where this site is actually reached.
 *
 * Sign-in cookies and the links inside emails are built from this, so a wrong value does not
 * fail loudly — it signs people in to an address nobody is visiting, or emails an invitation
 * pointing at localhost. One function, so every place that needs the address agrees.
 *
 * BETTER_AUTH_URL wins when it is set, which is what a real domain uses. Without it, Vercel's
 * own names stand in, so a first deployment works before anyone has set anything: the
 * project's stable production domain first, then this particular deployment's URL. Neither
 * carries a protocol, so one is added. Locally there is neither, and it is localhost.
 */
export function siteUrl(): string {
  const explicit = process.env.BETTER_AUTH_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}
