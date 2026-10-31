"use client";

import { useSafely } from "@/components/app/safely";
import { useModal } from "@/components/app/useModal";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { saveAsset } from "@/app/provider/(app)/equipment/actions";
import type { FormState } from "@/lib/auth-flows";
import type { AssetView } from "./EquipmentList";

type Option = { id: string; label: string };

function Buttons({ label, onClose }: { label: string; onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="form-actions">
      <button type="button" className="button button--soft" onClick={onClose} disabled={pending}>Cancel</button>
      <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}

export function AssetModal({ asset, kinds, onClose }: { asset: AssetView | null; kinds: Option[]; onClose: () => void }) {
  const [state, action] = useActionState(useSafely(saveAsset), {} as FormState);
  const ref = useRef<HTMLDivElement>(null);
  const close = useModal(ref, onClose);
  const done = Boolean(state.notice);

  useEffect(() => {
    if (done) {
      const t = setTimeout(onClose, 900);
      return () => clearTimeout(t);
    }
  }, [done, onClose]);


  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const val = (k: string, fallback = "") => v[k] ?? fallback;

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="asset-title" ref={ref}>
        <div className="modal__head">
          <h2 id="asset-title">{asset ? "Edit machine" : "Add equipment"}</h2>
          <p>Each machine is listed on its own, so two identical tractors keep separate histories.</p>
        </div>
        <form action={action} className="form-soft">
          {asset ? <input type="hidden" name="id" value={asset.id} /> : null}
          <div className={`field${e.kind ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="a-kind">What is it?</label>
            <div className="field__box">
              <select id="a-kind" name="kind" className="field__input" defaultValue={val("kind", asset?.kind ?? "")}>
                <option value="">Select a type</option>
                {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
            {e.kind ? <p className="field__error">{e.kind}</p> : null}
          </div>
          <Field name="name" label="Name" placeholder="Red Massey Ferguson" defaultValue={val("name", asset?.name ?? "")} error={e.name} />
          <Field name="identifier" label="Registration or serial number" placeholder="Optional, but it tells two identical machines apart"
            required={false} defaultValue={val("identifier", asset?.identifier ?? "")} error={e.identifier} />
          <div className={`field${e.ownership ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="a-own">Owned or leased?</label>
            <div className="field__box">
              <select id="a-own" name="ownership" className="field__input" defaultValue={val("ownership", asset?.ownership ?? "owned")}>
                <option value="owned">Owned</option>
                <option value="leased">Leased</option>
              </select>
            </div>
            {e.ownership ? <p className="field__error">{e.ownership}</p> : null}
          </div>
          <div className={`field${e.notes ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="a-notes">Condition and notes</label>
            <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
              <textarea id="a-notes" name="notes" className="field__input" rows={2} maxLength={400}
                defaultValue={val("notes", asset?.notes ?? "")} style={{ resize: "vertical" }} />
            </div>
            {e.notes ? <p className="field__error">{e.notes}</p> : null}
          </div>
          {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
          <FormNotice state={state} />
          <Buttons label={asset ? "Save changes" : "Add machine"} onClose={onClose} />
        </form>
      </div>
    </div>
  );
}
