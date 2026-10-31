"use client";

import { useSafely } from "@/components/app/safely";
import { useModal } from "@/components/app/useModal";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { reportWorkAction } from "@/app/provider/(app)/jobs/actions";
import type { FormState } from "@/lib/auth-flows";
import type { JobView } from "./JobsList";

function Buttons({ onClose }: { onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="form-actions">
      <button type="button" className="button button--soft" onClick={onClose} disabled={pending}>Cancel</button>
      <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>
        {pending ? "Sending…" : "Report the work"}
      </button>
    </div>
  );
}

export function ReportModal({ job, onClose }: { job: JobView; onClose: () => void }) {
  const [state, action] = useActionState(useSafely(reportWorkAction), {} as FormState);
  const ref = useRef<HTMLDivElement>(null);
  const close = useModal(ref, onClose);
  const done = Boolean(state.notice);

  useEffect(() => {
    if (done) {
      const t = setTimeout(onClose, 1400);
      return () => clearTimeout(t);
    }
  }, [done, onClose]);

  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rep-title" ref={ref}>
        <div className="modal__head">
          <h2 id="rep-title">Report the work</h2>
          <p>{job.reference} · agreed {job.acres} acres</p>
        </div>
        <form action={action} className="form-soft">
          <input type="hidden" name="jobId" value={job.id} />
          <Field name="acres" label="How much was done (acres)" type="text" inputMode="numeric"
            placeholder={String(job.acres)} defaultValue={v.acres} error={e.acres} />
          <div className={`field${e.note ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="r-note">Anything the farmer should know</label>
            <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
              <textarea id="r-note" name="note" className="field__input" rows={3} maxLength={400}
                defaultValue={v.note} style={{ resize: "vertical" }} />
            </div>
            {e.note ? <p className="field__error">{e.note}</p> : null}
          </div>
          <p className="field__helper">
            This is your report, not a delivery. The farmer has to confirm it, or raise a concern.
          </p>
          {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
          <FormNotice state={state} />
          <Buttons onClose={onClose} />
        </form>
      </div>
    </div>
  );
}
