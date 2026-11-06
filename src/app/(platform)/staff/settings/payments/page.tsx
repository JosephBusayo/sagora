import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/app/Shell";
import { PendingButton } from "@/components/app/PendingButton";
import { StaffShell } from "@/components/staff/StaffShell";
import { requireAdmin } from "@/lib/session";
import { monimeConfigured, monimeTestMode } from "@/lib/monime";
import { connectMonimeAction } from "../actions";

export const metadata: Metadata = { title: "Online payments" };
export const dynamic = "force-dynamic";

/**
 * Monime, for admins: whether it is set up, in which mode, and the one step that has to run on
 * the live site itself — telling Monime where to send its payment notices.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ done?: string; err?: string }> }) {
  const staff = await requireAdmin();
  const { done, err } = await searchParams;
  const ready = monimeConfigured();
  const secret = Boolean(process.env.MONIME_WEBHOOK_SECRET?.trim());
  // Monime only registers notices for a live token: its webhooks API refuses test ones.
  const test = ready && monimeTestMode();
  return (
    <StaffShell staff={staff} crumb={{ label: "Settings", icon: "settings" }}>
      <PageHead title="Online payments" subtitle="Monime, the payment provider farmers pay through" />
      <section className="form-soft form-soft--page">
        <dl className="detail-list">
          <div className="detail-row"><span className="detail-row__label">Status</span>
            <span className="detail-row__value">{ready ? "Connected" : "Not set up"}</span></div>
          <div className="detail-row"><span className="detail-row__label">Mode</span>
            <span className="detail-row__value">{!ready ? "—" : monimeTestMode() ? "Test: no real money moves" : "Live"}</span></div>
          <div className="detail-row"><span className="detail-row__label">Payment notices</span>
            <span className="detail-row__value">{secret ? "Secret set" : "MONIME_WEBHOOK_SECRET is missing"}</span></div>
        </dl>
        {!ready ? (
          <p className="field__helper">Add MONIME_ACCESS_TOKEN and MONIME_SPACE_ID in Vercel, then redeploy.</p>
        ) : null}
        {done ? <p className="notice notice--success" role="status">{done}</p> : null}
        {err ? <p className="notice notice--error" role="alert">{err}</p> : null}
        <form action={connectMonimeAction} className="form-actions">
          <Link href="/staff/settings" className="button button--soft" style={{ display: "grid", placeItems: "center" }}>Close</Link>
          <PendingButton className="button" disabled={!ready || !secret || test}>Set up payment notices</PendingButton>
        </form>
        {test ? (
          <p className="field__helper">
            Monime only sets up payment notices for a live token. In test mode, a payment is recorded when the farmer comes
            back to Sagora after paying, or by the daily check. Switch to a live token, then set up payment notices here.
          </p>
        ) : null}
        <p className="field__helper">
          Tells Monime to let Sagora know when a farmer pays, so the payment is recorded straight away. Safe to press again,
          for example after switching from test to live.
        </p>
      </section>
    </StaffShell>
  );
}
