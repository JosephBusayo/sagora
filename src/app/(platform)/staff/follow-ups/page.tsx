import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/app/Shell";
import { PendingButton } from "@/components/app/PendingButton";
import { StaffShell } from "@/components/staff/StaffShell";
import { THRESHOLDS, queues, thresholds } from "@/lib/follow-ups";
import { requireStaff } from "@/lib/session";
import { listStaff } from "@/lib/staff";
import { saveFollowUpAction, saveThresholdsAction } from "../follow-up-actions";

export const metadata: Metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Freetown" });

/** UC14: everything waiting on someone, with an owner, the next action and a due date. No Figma frame exists for this. */
export default async function Page() {
  const staff = await requireStaff();
  const [all, people, limits] = await Promise.all([queues(), listStaff(), thresholds()]);
  const names = new Map(people.map((p) => [p.id, p.name || p.email]));
  const total = all.reduce((t, q) => t + q.items.length, 0);
  return (
    <StaffShell staff={staff} crumb={{ label: "Follow-ups", icon: "jobs" }}>
      <PageHead
        title="Follow-ups"
        subtitle={total ? `${total} open ${total === 1 ? "item" : "items"}. Give each one an owner, a next action and a due date.` : "Nothing is waiting."}
      />
      <nav className="queue-nav" aria-label="Queues">
        {all.map((q) => <a key={q.id} href={`#q-${q.id}`}>{q.title} <span className="queue-nav__n">{q.items.length}</span></a>)}
      </nav>
      {all.map((q) => (
        <section key={q.id} id={`q-${q.id}`} className="staff__item queue">
          <h2>{q.title} <span className="queue-nav__n">{q.items.length}</span></h2>
          <p className="field__helper">{q.body}</p>
          {q.items.length === 0 ? <p className="field__helper">Nothing here.</p> : (
            <ul className="queue__list">
              {q.items.map((i) => (
                <li key={i.key} className={`queue__item${i.overdue ? " queue__item--late" : ""}`}>
                  <div className="queue__head">
                    <strong>{i.href ? <Link href={i.href}>{i.reference}</Link> : i.reference}</strong>
                    <span>{i.title}</span>
                    {i.overdue ? <span className="pill pill--cancelled">Overdue</span> : null}
                  </div>
                  <p className="field__helper">{i.detail} · last activity {when(i.since)}</p>
                  {i.followUp ? (
                    <p className="field__helper">
                      Owner: {i.followUp.ownerId ? names.get(i.followUp.ownerId) ?? "Former staff" : "nobody yet"}
                      {i.followUp.nextAction ? ` · Next: ${i.followUp.nextAction}` : ""}
                      {i.followUp.dueOn ? ` · Due ${i.followUp.dueOn}` : ""}
                      {i.followUp.note ? ` · ${i.followUp.note}` : ""}
                    </p>
                  ) : null}
                  <details>
                    <summary>{i.followUp ? "Update follow-up" : "Add follow-up"}</summary>
                    <form action={saveFollowUpAction} className="form-soft queue__form">
                      <input type="hidden" name="key" value={i.key} />
                      <div className="field">
                        <label className="field__label" htmlFor={`o-${i.key}`}>Owner</label>
                        <div className="field__box">
                          <select id={`o-${i.key}`} name="ownerId" className="field__input" defaultValue={i.followUp?.ownerId ?? staff.id}>
                            <option value="">Nobody yet</option>
                            {people.map((p) => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="field">
                        <label className="field__label" htmlFor={`a-${i.key}`}>Next action</label>
                        <div className="field__box">
                          <input id={`a-${i.key}`} name="nextAction" className="field__input" maxLength={200} defaultValue={i.followUp?.nextAction} placeholder="For example, call the farmer" />
                        </div>
                      </div>
                      <div className="field">
                        <label className="field__label" htmlFor={`d-${i.key}`}>Due</label>
                        <div className="field__box"><input id={`d-${i.key}`} name="dueOn" type="date" className="field__input" defaultValue={i.followUp?.dueOn} /></div>
                      </div>
                      <div className="field">
                        <label className="field__label" htmlFor={`n-${i.key}`}>Note</label>
                        <div className="field__box"><input id={`n-${i.key}`} name="note" className="field__input" maxLength={400} defaultValue={i.followUp?.note} /></div>
                      </div>
                      <PendingButton className="button button--inline">Save follow-up</PendingButton>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {staff.role === "admin" ? (
        <section className="staff__item">
          <h2>When things count as overdue</h2>
          <form action={saveThresholdsAction} className="form-soft queue__form">
            {THRESHOLDS.map((t) => (
              <div key={t.key} className="field">
                <label className="field__label" htmlFor={`t-${t.key}`}>{t.label}</label>
                <div className="field__box">
                  <input id={`t-${t.key}`} name={t.key} type="number" min={1} max={365} className="field__input" defaultValue={limits[t.key]} />
                </div>
              </div>
            ))}
            <PendingButton className="button button--inline">Save</PendingButton>
          </form>
        </section>
      ) : null}
    </StaffShell>
  );
}
