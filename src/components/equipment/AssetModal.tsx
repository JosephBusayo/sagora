"use client";

import { CheckFirst } from "@/components/app/CheckFirst";
import { useSafely } from "@/components/app/safely";
import { useModal } from "@/components/app/useModal";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { specsFor } from "@/lib/specs";
import { saveAsset } from "@/app/(platform)/provider/(app)/equipment/actions";
import type { FormState } from "@/lib/auth-flows";
import type { AssetView } from "./EquipmentList";
import { PhotoPicker } from "./PhotoPicker";

type Option = { id: string; label: string };

/** Which step of Add equipment each field is on, so a server error opens the right one. */
const STEP_OF: Record<string, number> = {
  kind: 0, brand: 0, model: 0, year: 0, identifier: 0, serialStatus: 0, assetRef: 0,
  lessor: 0, leaseFrom: 0, leaseTo: 0,
  horsepower: 1, implements: 1, services: 1, location: 1, custodian: 1, specs: 1,
  availability: 2, photo: 2, condition: 2, conditionNote: 2,
};

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
export function AssetModal({ asset, kinds, services, availability, serialStates, onClose }: {
  asset: AssetView | null; kinds: Option[]; services: Option[]; availability: Option[];
  /** Passed in rather than imported: lib/equipment is server-only and this is a client component. */
  serialStates: Option[]; onClose: () => void;
}) {
  const [state, action] = useActionState(useSafely(saveAsset), {} as FormState);
  const [step, setStep] = useState(0);
  // Which specifications to ask for depends on the kind, so the form follows the select.
  const [kind, setKind] = useState(asset?.kind ?? "");
  // Lease fields only exist on a leased machine, and the handover says Owned or Leased has no
  // default — a provider has to say which.
  const [ownership, setOwnership] = useState(asset?.ownership ?? "");
  const [serialStatus, setSerialStatus] = useState<string>(asset?.serialStatus ?? "recorded");
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
          <CheckFirst title="Check the equipment details" action={editing ? "Save changes" : "Add equipment"} />
          {asset ? <input type="hidden" name="id" value={asset.id} /> : null}
          {asset ? <input type="hidden" name="ownership" value={asset.ownership} /> : null}
          {asset ? <input type="hidden" name="notes" value={asset.notes} /> : null}

          <div className="form-step" hidden={!shown(0)}>
            <div className={`field${e.kind ? " field--invalid" : ""}`}>
              <label className="field__label" htmlFor="a-kind">Equipment type</label>
              <div className="field__box">
                <select id="a-kind" name="kind" className="field__input" value={kind} onChange={(ev) => setKind(ev.target.value)}>
                  <option value="">Select equipment type</option>
                  {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </div>
              {e.kind ? <p className="field__error">{e.kind}</p> : null}
            </div>
            <Field name="brand" label="Brand" placeholder="eg: CAT" defaultValue={val("brand", legacyBrand)} error={e.brand} />
            <Field name="model" label="Model" placeholder="eg: 5075E" defaultValue={val("model", asset?.model ?? "")} error={e.model} />
            <Field name="year" label="Year (optional)" placeholder="eg: 2022" inputMode="numeric" required={false} defaultValue={val("year", asset?.year ?? "")} error={e.year} />
            {/* Required now that a quote names specific machines: a farmer accepting one is
                committing this exact machine, so it has to be identifiable. */}
            <Field name="identifier" label="Registration or serial number" placeholder="Tells two identical pieces of equipment apart"
              required={serialStatus === "recorded"}
              defaultValue={val("identifier", asset?.identifier ?? "")} error={e.identifier} />

            {/* "Missing or unreadable machine serials permit draft saving and review only."
                Saying so is allowed; it just means the machine cannot be quoted until somebody at
                Sagora has looked at it. */}
            <div className={`field${e.serialStatus ? " field--invalid" : ""}`}>
              <label className="field__label" htmlFor="a-serial-status">Is that number readable on the machine?</label>
              <div className="field__box">
                <select id="a-serial-status" name="serialStatus" className="field__input"
                  value={serialStatus} onChange={(ev) => setSerialStatus(ev.target.value)}>
                  {serialStates.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </div>
              {e.serialStatus ? <p className="field__error">{e.serialStatus}</p> : serialStatus !== "recorded" ? (
                <p className="field__helper">
                  You can register it and we will review it. Until then this machine cannot be put on a quote.
                </p>
              ) : null}
            </div>

            <Field name="assetRef" label="Your own reference for it (optional)" placeholder="eg: FFSL-014"
              required={false} defaultValue={val("assetRef", asset?.assetRef ?? "")} error={e.assetRef} />

            {/* Owned or Leased with no default, per the handover. On an edit the existing value is
                posted by the hidden field above, so this only appears when registering. */}
            {!asset ? (
              <div className={`field${e.ownership ? " field--invalid" : ""}`}>
                <label className="field__label" htmlFor="a-ownership">Do you own it or lease it?</label>
                <div className="field__box">
                  <select id="a-ownership" name="ownership" className="field__input"
                    value={ownership} onChange={(ev) => setOwnership(ev.target.value)}>
                    <option value="">Choose one</option>
                    <option value="owned">Owned</option>
                    <option value="leased">Leased</option>
                  </select>
                </div>
                {e.ownership ? <p className="field__error">{e.ownership}</p> : null}
              </div>
            ) : null}

            {ownership === "leased" ? (
              <>
                <Field name="lessor" label="Who owns it" placeholder="The lessor, where that is not you"
                  required={false} defaultValue={val("lessor", asset?.lessor ?? "")} error={e.lessor} />
                <div className="form-row">
                  <div className={`field${e.leaseFrom ? " field--invalid" : ""}`}>
                    <label className="field__label" htmlFor="a-lease-from">You can use it from</label>
                    <div className="field__box">
                      <input id="a-lease-from" name="leaseFrom" type="date" className="field__input"
                        defaultValue={val("leaseFrom", asset?.leaseFrom ?? "")} suppressHydrationWarning />
                    </div>
                    {e.leaseFrom ? <p className="field__error">{e.leaseFrom}</p> : null}
                  </div>
                  <div className={`field${e.leaseTo ? " field--invalid" : ""}`}>
                    <label className="field__label" htmlFor="a-lease-to">until</label>
                    <div className="field__box">
                      <input id="a-lease-to" name="leaseTo" type="date" className="field__input"
                        defaultValue={val("leaseTo", asset?.leaseTo ?? "")} suppressHydrationWarning />
                    </div>
                    {e.leaseTo ? <p className="field__error">{e.leaseTo}</p>
                      : <p className="field__helper">Work cannot be quoted past this day.</p>}
                  </div>
                </div>
                <Field name="leaseNotes" label="Any restrictions (optional)" placeholder="eg: not for hire outside Bombali"
                  required={false} defaultValue={val("leaseNotes", asset?.leaseNotes ?? "")} error={e.leaseNotes} />
              </>
            ) : null}
          </div>

          <div className="form-step" hidden={!shown(1)}>
            <Field name="horsepower" label="Horsepower (HP)" placeholder="eg: 75" inputMode="numeric" required={false} defaultValue={val("horsepower", asset?.horsepower ?? "")} error={e.horsepower} />
            <Field name="implements" label="Implement(s) or attachment(s)" placeholder="eg: 4-disc plough, harrow, planter" required={false}
              defaultValue={val("implements", asset?.implements ?? "")} error={e.implements} />
            <Chips name="services" legend="Services" type="checkbox" options={services}
              checked={(v.services ?? asset?.services.join(",") ?? "").split(",").filter(Boolean)} error={e.services} />

            {/* Only the specifications this kind actually has. A drum seeder is never asked for a
                PTO speed, and a tractor is never asked for a working width. */}
            {kind ? (
              <fieldset className="field asset-specs">
                <legend className="field__label">Specifications</legend>
                {specsFor(kind).map((spec) => (
                  <div key={spec.id} className={`field${e[`spec_${spec.id}`] ? " field--invalid" : ""}`}>
                    <label className="field__label" htmlFor={`a-spec-${spec.id}`}>
                      {spec.label}{spec.unit ? ` (${spec.unit})` : ""}{spec.critical ? "" : " (optional)"}
                    </label>
                    <div className="field__box">
                      {spec.kind === "choice" ? (
                        <select id={`a-spec-${spec.id}`} name={`spec_${spec.id}`} className="field__input"
                          defaultValue={val(`spec_${spec.id}`, asset?.specs?.[spec.id] ?? "")}>
                          <option value="">Not known</option>
                          {(spec.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input id={`a-spec-${spec.id}`} name={`spec_${spec.id}`} className="field__input"
                          inputMode={spec.kind === "number" ? "decimal" : undefined}
                          defaultValue={val(`spec_${spec.id}`, asset?.specs?.[spec.id] ?? "")} />
                      )}
                    </div>
                    {e[`spec_${spec.id}`] ? <p className="field__error">{e[`spec_${spec.id}`]}</p>
                      : spec.hint ? <p className="field__helper">{spec.hint}</p> : null}
                  </div>
                ))}
                <p className="field__helper">
                  Anything marked without &ldquo;optional&rdquo; has to be recorded before this machine can go on a quote:
                  without it nobody can check what it fits.
                </p>
              </fieldset>
            ) : null}

            {/* "Last confirmed physical location, timestamp and updater. Coverage districts are
                separate" — this is the yard, not where the business works. */}
            <Field name="location" label="Where it is kept (optional)" placeholder="eg: Makeni yard"
              required={false} defaultValue={val("location", asset?.location ?? "")} error={e.location} />
            <Field name="custodian" label="Who has it (optional)" placeholder="The person it is with right now"
              required={false} defaultValue={val("custodian", asset?.custodian ?? "")} error={e.custodian} />
          </div>

          <div className="form-step" hidden={!(editing || step === 2)}>
            {editing
              ? <PhotoPicker name="photo" label="Photo (optional)" current={asset?.photo} emptyText="Add an image" />
              : <PhotoPicker name="photo" label="Add images of your equipment" current={asset?.photo} emptyText="Upload photos"
                  helper="Add clear photos of your equipment (max 5MB each)" />}
            {e.photo ? <p className="field__error">{e.photo}</p> : null}
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
