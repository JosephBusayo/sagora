"use client";

import { CheckFirst } from "@/components/app/CheckFirst";
import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { saveSetup } from "@/app/(platform)/provider/setup/actions";
import type { FormState } from "@/app/(platform)/provider/actions";
import { Field } from "@/components/auth/Field";

type Initial = {
  name: string; phone: string; email: string; district: string; town: string;
  services: string[]; description: string;
  businessType: string; authorisedName: string; authorisedRole: string; pricingBasis: string;
  includedCosts: string; depositTerms: string; cancellationTerms: string;
};
type Option = { id: string; label: string };
type Props = { initial: Initial; districts: readonly string[]; services: readonly Option[]; businessTypes: readonly Option[]; pricingBases: readonly Option[] };

function Choice({ name, label, options, value, error }: { name: string; label: string; options: readonly Option[]; value: string; error?: string }) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`s-${name}`}>{label}</label>
      <div className="field__box">
        <select id={`s-${name}`} name={name} className="field__input" defaultValue={value} aria-invalid={error ? true : undefined}>
          <option value="">Select</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="setup__buttons">
      <button type="submit" name="intent" value="draft" className="button button--ghost" disabled={pending} formNoValidate data-check-skip>
        Save for later
      </button>
      <button type="submit" name="intent" value="submit" className="button" disabled={pending} aria-busy={pending} formNoValidate>
        {pending ? "Please wait…" : "Submit for review"}
      </button>
    </div>
  );
}

export function SetupForm({ initial, districts, services, businessTypes, pricingBases }: Props) {
  const [state, action] = useActionState(useSafely(saveSetup), {} as FormState);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const val = (k: keyof Initial) => (v[k] !== undefined ? v[k] : (initial[k] as string));
  const chosen = new Set(v.services !== undefined ? v.services.split(",").filter(Boolean) : initial.services);
  const districtId = useId();
  const descId = useId();

  return (
    <form action={action} className="setup__form">
      <CheckFirst title="Check your business details" action="Submit for review" />
      <Field name="name" label="Business name" placeholder="Enter your business name" autoComplete="organization" defaultValue={val("name")} error={e.name} />
      <Field name="phone" label="Business phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000" autoComplete="tel-national" defaultValue={val("phone").replace(/^\+232/, "")} error={e.phone} />
      <Field name="email" label="Business email" type="email" inputMode="email" placeholder="abc@gmail.com" autoComplete="email" defaultValue={val("email")} error={e.email} />
      <Choice name="businessType" label="What kind of business is this?" options={businessTypes} value={val("businessType")} error={e.businessType} />
      <Field name="authorisedName" label="Person who can offer and allocate your equipment" placeholder="Full name" defaultValue={val("authorisedName")} error={e.authorisedName} />
      <Field name="authorisedRole" label="Their role" placeholder="For example, owner or manager" defaultValue={val("authorisedRole")} error={e.authorisedRole} />

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

      <Field icon="pin" name="town" label="Town or village" placeholder="Where your equipment is based" defaultValue={val("town")} error={e.town} />

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

      <Choice name="pricingBasis" label="How do you price work?" options={pricingBases} value={val("pricingBasis")} error={e.pricingBasis} />
      <Field name="includedCosts" label="What your price includes" placeholder="For example, operator and fuel, not transport" maxLength={300} defaultValue={val("includedCosts")} error={e.includedCosts} />
      <Field name="depositTerms" label="Deposit you ask for" placeholder="For example, half before we travel, or No deposit" maxLength={300} defaultValue={val("depositTerms")} error={e.depositTerms} />
      <Field name="cancellationTerms" label="If the work is cancelled" placeholder="For example, full refund up to 2 days before" maxLength={300} defaultValue={val("cancellationTerms")} error={e.cancellationTerms} />
      {e.documents ? <p className="notice notice--error" role="alert">{e.documents}</p> : null}

      <div className={`field${e.description ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor={descId}>About your business <span className="setup__optional">(optional)</span></label>
        <div className="field__box setup__textarea">
          <textarea id={descId} name="description" className="field__input" rows={4} maxLength={500} defaultValue={val("description")} placeholder="Tell farmers what you do and the area you cover" />
        </div>
        {e.description ? <p className="field__error">{e.description}</p> : null}
      </div>

      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      <FormNotice state={state} />
      <Buttons />
    </form>
  );
}
