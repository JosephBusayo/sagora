"use client";

import { today } from "@/components/app/today";
import { useSafely } from "@/components/app/safely";
import { useModal } from "@/components/app/useModal";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { scheduleJobAction } from "@/app/provider/(app)/jobs/actions";
import type { FormState } from "@/lib/auth-flows";
import type { JobView, Option } from "./JobsList";

function Buttons({ onClose }: { onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="form-actions">
      <button type="button" className="button button--soft" onClick={onClose} disabled={pending}>Cancel</button>
      <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Commit the machines"}
      </button>
    </div>
  );
}

export function ScheduleModal({ job, assets, operators, onClose }: {
  job: JobView; assets: Option[]; operators: Option[]; onClose: () => void;
}) {
  const [state, action] = useActionState(useSafely(scheduleJobAction), {} as FormState);
  const ref = useRef<HTMLDivElement>(null);
  const close = useModal(ref, onClose);
  const done = Boolean(state.notice);

  useEffect(() => {
    if (done) {
      const t = setTimeout(onClose, 1200);
      return () => clearTimeout(t);
    }
  }, [done, onClose]);

  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const chosen = new Set(job.schedule.assetIds);

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sched-title" ref={ref}>
        <div className="modal__head">
          <h2 id="sched-title">Schedule {job.reference}</h2>
          <p>{job.serviceLabel} · {job.acres} acres · {job.village}, {job.district}</p>
        </div>
        <form action={action} className="form-soft">
          <input type="hidden" name="jobId" value={job.id} />
          <div className="form-row">
            <div className={`field${e.startDate ? " field--invalid" : ""}`}>
              <label className="field__label" htmlFor="j-start">Work starts</label>
              <div className="field__box">
                <input id="j-start" name="startDate" type="date" min={today()} suppressHydrationWarning className="field__input" defaultValue={v.startDate ?? job.schedule.startDate} />
              </div>
              {e.startDate ? <p className="field__error">{e.startDate}</p> : null}
            </div>
            <div className={`field${e.endDate ? " field--invalid" : ""}`}>
              <label className="field__label" htmlFor="j-end">Work ends</label>
              <div className="field__box">
                <input id="j-end" name="endDate" type="date" min={today()} suppressHydrationWarning className="field__input" defaultValue={v.endDate ?? job.schedule.endDate} />
              </div>
              {e.endDate ? <p className="field__error">{e.endDate}</p> : null}
            </div>
          </div>

          <fieldset className={`field${e.assetIds ? " field--invalid" : ""}`} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label">Machines</legend>
            {assets.length === 0 ? (
              <p className="field__helper">No machine is available. Add one on the Equipment screen, or clear a fault.</p>
            ) : (
              <div className="setup__checks">
                {assets.map((a) => (
                  <label key={a.id} className="setup__check">
                    <input type="checkbox" name="assetIds" value={a.id} defaultChecked={chosen.has(a.id)} />
                    <span>{a.label}</span>
                  </label>
                ))}
              </div>
            )}
            {e.assetIds ? <p className="field__error">{e.assetIds}</p> : null}
          </fieldset>

          <div className="field">
            <label className="field__label" htmlFor="j-op">Operator</label>
            <div className="field__box">
              <select id="j-op" name="operatorId" className="field__input" defaultValue={v.operatorId ?? job.schedule.operatorId}>
                <option value="">Not decided yet</option>
                {operators.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <p className="field__helper">
            A machine can only be on one job at a time. If it is already committed for these dates, this will be refused.
          </p>
          {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
          <FormNotice state={state} />
          <Buttons onClose={onClose} />
        </form>
      </div>
    </div>
  );
}
