"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { reportFaultAction } from "@/app/provider/(app)/equipment/actions";
import type { FormState } from "@/lib/auth-flows";
import type { AssetView } from "./EquipmentList";

function Buttons({ onClose }: { onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="form-actions">
      <button type="button" className="button button--soft" onClick={onClose} disabled={pending}>Cancel</button>
      <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Record fault"}
      </button>
    </div>
  );
}

export function FaultModal({ asset, onClose }: { asset: AssetView; onClose: () => void }) {
  const [state, action] = useActionState(reportFaultAction, {} as FormState);
  const ref = useRef<HTMLDivElement>(null);
  const done = Boolean(state.notice);

  useEffect(() => {
    if (done) {
      const t = setTimeout(onClose, 1400);
      return () => clearTimeout(t);
    }
  }, [done, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const e = state.fieldErrors ?? {};

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fault-title" ref={ref}>
        <div className="modal__head">
          <h2 id="fault-title">Report a fault</h2>
          <p>{asset.name} · {asset.kindLabel}</p>
        </div>
        <form action={action} className="form-soft">
          <input type="hidden" name="equipmentId" value={asset.id} />
          <fieldset className={`field${e.severity ? " field--invalid" : ""}`} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label">How serious is it?</legend>
            <div className="setup__checks">
              <label className="setup__check">
                <input type="radio" name="severity" value="blocking" defaultChecked />
                <span>Cannot be used</span>
              </label>
              <label className="setup__check">
                <input type="radio" name="severity" value="minor" />
                <span>Still usable</span>
              </label>
            </div>
            {e.severity ? <p className="field__error">{e.severity}</p> : null}
          </fieldset>
          <div className={`field${e.description ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="f-desc">What is wrong?</label>
            <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
              <textarea id="f-desc" name="description" className="field__input" rows={3} maxLength={400}
                placeholder="Hydraulic leak on the left arm" style={{ resize: "vertical" }} />
            </div>
            {e.description ? <p className="field__error">{e.description}</p> : null}
          </div>
          <p className="field__helper">
            A fault never erases work already committed. It marks the machine so it is not given out again.
          </p>
          {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
          {state.notice ? <p className="notice notice--success" role="status">{state.notice}</p> : null}
          <Buttons onClose={onClose} />
        </form>
      </div>
    </div>
  );
}
