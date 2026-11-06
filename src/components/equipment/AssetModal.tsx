"use client";

import { useSafely } from "@/components/app/safely";
import { useModal } from "@/components/app/useModal";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { saveAsset } from "@/app/provider/(app)/equipment/actions";
import type { FormState } from "@/lib/auth-flows";
import type { AssetView } from "./EquipmentList";

type Option = { id: string; label: string };

/** Which step of Add equipment each field is on, so a server error opens the right one. */
const STEP_OF: Record<string, number> = { kind: 0, brand: 0, model: 0, year: 0, identifier: 0, horsepower: 1, implements: 1, services: 1, availability: 2 };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}

function Chips({ name, legend, options, checked, type, error }: {
  name: string; legend: string; options: Option[]; checked: string[]; type: "checkbox" | "radio"; error?: string;
}) {
  return (
    <fieldset className={`chips${error ? " field--invalid" : ""}`}>
      <legend className="field__label">{legend}</legend>
      <div className="chips__row">
        {options.map((o) => (
          <label key={o.id} className="chip">
            <input type={type} name={name} value={o.id} defaultChecked={checked.includes(o.id)} />
            <span className="chip__icon" aria-hidden="true" />
            {o.label}
          </label>
        ))}
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </fieldset>
  );
}

/**
 * Add equipment, in the design's three steps, and Edit details, as one page. All three steps are
 * one form: the steps only show and hide fields, so nothing typed is lost moving between them,
 * and the server checks everything once at the end.
 */
export function AssetModal({ asset, kinds, services, availability, onClose }: {
  asset: AssetView | null; kinds: Option[]; services: Option[]; availability: Option[]; onClose: () => void;
}) {
  const [state, action] = useActionState(useSafely(saveAsset), {} as FormState);
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const close = useModal(ref, onClose);
  const done = Boolean(state.notice);
  const editing = Boolean(asset);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const val = (k: string, fallback = "") => v[k] ?? fallback;

  useEffect(() => {
    if (done) {
      const t = setTimeout(onClose, 900);
      return () => clearTimeout(t);
    }
  }, [done, onClose]);

  // A server error sends you back to the first step that has one.
  const firstBad = Object.keys(e).map((k) => STEP_OF[k] ?? 0).sort()[0];
  useEffect(() => {
    if (firstBad !== undefined) setStep(firstBad); // eslint-disable-line react-hooks/set-state-in-effect
  }, [state, firstBad]);

  // Moving on checks only what this step asks for; the server checks it all again.
  const next = () => {
    const fd = new FormData(form.current!);
    const missing = step === 0
      ? (!fd.get("kind") ? "Choose the equipment type" : !String(fd.get("brand") ?? "").trim() ? "Enter the brand" : !String(fd.get("model") ?? "").trim() ? "Enter the model" : "")
      : fd.getAll("services").length === 0 ? "Choose what this equipment is used for" : "";
    setStepError(missing);
    if (!missing) setStep(step + 1);
  };

  const shown = (n: number) => editing || step === n;
  const legacyBrand = asset && !asset.brand && !asset.model ? asset.name : asset?.brand ?? "";

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="modal modal--asset" role="dialog" aria-modal="true" aria-labelledby="asset-title" ref={ref}>
        <div className="modal__head modal__head--center">
          <h2 id="asset-title">{editing ? "Edit details" : "Add equipment"}</h2>
          <p>{editing ? "Edit details about your equipment" : "Tell us about your equipment"}</p>
        </div>
        <form ref={form} action={action} className="form-soft">
          {asset ? <input type="hidden" name="id" value={asset.id} /> : null}
          {asset ? <input type="hidden" name="ownership" value={asset.ownership} /> : null}
          {asset ? <input type="hidden" name="notes" value={asset.notes} /> : null}

          <div className="form-step" hidden={!shown(0)}>
            <div className={`field${e.kind ? " field--invalid" : ""}`}>
              <label className="field__label" htmlFor="a-kind">Equipment type</label>
              <div className="field__box">
                <select id="a-kind" name="kind" className="field__input" defaultValue={val("kind", asset?.kind ?? "")}>
                  <option value="">Select equipment type</option>
                  {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </div>
              {e.kind ? <p className="field__error">{e.kind}</p> : null}
            </div>
            <Field name="brand" label="Brand" placeholder="eg: CAT" defaultValue={val("brand", legacyBrand)} error={e.brand} />
            <Field name="model" label="Model" placeholder="eg: 5075E" defaultValue={val("model", asset?.model ?? "")} error={e.model} />
            <Field name="year" label="Year (optional)" placeholder="eg: 2022" inputMode="numeric" required={false} defaultValue={val("year", asset?.year ?? "")} error={e.year} />
            <Field name="identifier" label="Registration or serial number (optional)" placeholder="Tells two identical pieces of equipment apart"
              required={false} defaultValue={val("identifier", asset?.identifier ?? "")} error={e.identifier} />
          </div>

          <div className="form-step" hidden={!shown(1)}>
            <Field name="horsepower" label="Horsepower (HP)" placeholder="eg: 75" inputMode="numeric" required={false} defaultValue={val("horsepower", asset?.horsepower ?? "")} error={e.horsepower} />
            <Field name="implements" label="Implement(s) or attachment(s)" placeholder="eg: 4-disc plough, harrow, planter" required={false}
              defaultValue={val("implements", asset?.implements ?? "")} error={e.implements} />
            <Chips name="services" legend="Services" type="checkbox" options={services}
              checked={(v.services ?? asset?.services.join(",") ?? "").split(",").filter(Boolean)} error={e.services} />
          </div>

          {!editing ? (
            <div className="form-step" hidden={step !== 2}>
              <Chips name="availability" legend="Availability status" type="radio" options={availability}
                checked={[val("availability", "available")]} error={e.availability} />
            </div>
          ) : null}

          {stepError ? <p className="notice notice--error" role="alert">{stepError}</p> : null}
          {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
          <FormNotice state={state} />

          {!editing ? (
            <div className="steps" aria-label={`Step ${step + 1} of 3`}>
              {[0, 1, 2].map((n) => <span key={n} className={`steps__bar${n <= step ? " steps__bar--on" : ""}`} />)}
            </div>
          ) : null}

          <div className="form-actions">
            <button type="button" className="button button--soft" onClick={step > 0 && !editing ? () => setStep(step - 1) : onClose}>
              {step > 0 && !editing ? "Back" : "Cancel"}
            </button>
            {editing || step === 2
              ? <Submit label={editing ? "Save changes" : "Add equipment"} />
              : <button type="button" className="button" onClick={next}>Continue</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
