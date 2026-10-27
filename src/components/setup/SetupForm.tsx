"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { saveSetup } from "@/app/provider/setup/actions";
import type { FormState } from "@/app/provider/actions";
import { Field } from "@/components/auth/Field";

type Initial = {
  name: string; phone: string; email: string; district: string; town: string;
  services: string[]; description: string;
};
type Props = { initial: Initial; districts: readonly string[]; services: readonly { id: string; label: string }[] };

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="setup__buttons">
      <button type="submit" name="intent" value="draft" className="button button--ghost" disabled={pending} formNoValidate>
        Save for later
      </button>
      <button type="submit" name="intent" value="submit" className="button" disabled={pending} aria-busy={pending}>
        {pending ? "Please wait…" : "Submit for review"}
      </button>
    </div>
  );
}

export function SetupForm({ initial, districts, services }: Props) {
  const [state, action] = useActionState(saveSetup, {} as FormState);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const val = (k: keyof Initial) => (v[k] !== undefined ? v[k] : (initial[k] as string));
  const chosen = new Set(v.services !== undefined ? v.services.split(",").filter(Boolean) : initial.services);
  const districtId = useId();
  const descId = useId();

  return (
    <form action={action} className="setup__form">
      <Field name="name" label="Business name" placeholder="Enter your business name" autoComplete="organization" defaultValue={val("name")} error={e.name} />
      <Field name="phone" label="Business phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000" autoComplete="tel-national" defaultValue={val("phone").replace(/^\+232/, "")} error={e.phone} />
      <Field name="email" label="Business email" type="email" inputMode="email" placeholder="abc@gmail.com" autoComplete="email" defaultValue={val("email")} error={e.email} />

      <div className={`field${e.district ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor={districtId}>District</label>
        <div className="field__box">
          <select id={districtId} name="district" className="field__input" defaultValue={val("district")} aria-invalid={e.district ? true : undefined}>
            <option value="">Select a district</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {e.district ? <p className="field__error">{e.district}</p> : null}
      </div>

      <Field name="town" label="Town or village" placeholder="Where your equipment is based" defaultValue={val("town")} error={e.town} />

      <fieldset className={`field setup__services${e.services ? " field--invalid" : ""}`}>
        <legend className="field__label">Services you offer</legend>
        <div className="setup__checks">
          {services.map((s) => (
            <label key={s.id} className="setup__check">
              <input type="checkbox" name="services" value={s.id} defaultChecked={chosen.has(s.id)} />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
        {e.services ? <p className="field__error">{e.services}</p> : null}
      </fieldset>

      <div className={`field${e.description ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor={descId}>About your business <span className="setup__optional">(optional)</span></label>
        <div className="field__box setup__textarea">
          <textarea id={descId} name="description" className="field__input" rows={4} maxLength={500} defaultValue={val("description")} placeholder="Tell farmers what you do and the area you cover" />
        </div>
        {e.description ? <p className="field__error">{e.description}</p> : null}
      </div>

      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      {state.notice ? <p className="notice notice--success" role="status">{state.notice}</p> : null}
      <Buttons />
    </form>
  );
}
