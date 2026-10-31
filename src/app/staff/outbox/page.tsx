import { PendingButton } from "@/components/app/PendingButton";
import { StaffNav } from "@/components/staff/StaffNav";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/session";
import { counts, listProblems } from "@/lib/outbox";
import { drainNowAction, retryMessageAction } from "../outbox-actions";

export const metadata: Metadata = { title: "Notification queue" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * The staff queue the brief asks for: every notification that did not go out first time,
 * with the error and a way to try again. Nothing here blocked the work that created it.
 */
export default async function Page() {
  const staff = await requireStaff();
  const { pending, failed, sent } = await counts();
  const rows = await listProblems();

  return (
    <main className="setup">
      <div className="setup__card setup__card--wide">
        <StaffNav current="outbox" role={staff.role} />
        <h1 className="auth__title">Notification queue</h1>
        <p className="auth__subtitle">
          Messages are saved before they are sent, so nothing is lost when email fails.
          {" "}{sent} sent · {pending} waiting · {failed} gave up.
        </p>

        <form action={drainNowAction}>
          <PendingButton className="button button--inline">Try the queue now</PendingButton>
        </form>

        {rows.length === 0 ? (
          <p className="empty">Nothing has failed. Every message went out first time.</p>
        ) : (
          <div className="table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">To</th>
                  <th scope="col">What</th>
                  <th scope="col">Tries</th>
                  <th scope="col">Last error</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.recipient}</td>
                    <td>{r.kind}<br /><span className="field__helper">{r.subject}</span></td>
                    <td>{r.attempts}</td>
                    <td><span className="field__helper">{r.lastError || "—"}</span></td>
                    <td>
                      <span className={`pill pill--${r.status === "failed" ? "cancelled" : "in_progress"}`}>
                        {r.status === "failed" ? "Gave up" : `Retrying ${when(r.nextAttemptAt)}`}
                      </span>
                    </td>
                    <td className="table__actions">
                      {r.status === "failed" ? (
                        <form action={retryMessageAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <PendingButton className="resend__button">Try again</PendingButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
