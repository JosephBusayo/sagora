"use client";

import { useSafely } from "@/components/app/safely";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { createAssistedAction } from "@/app/staff/assisted-actions";
import type { FormState } from "@/lib/auth-flows";

type Option = { id: string; label: string };

function Save() {
  const { pending } = useFormStatus();
  return <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Create request"}</button>;
}

function Select({ name, label, options, placeholder, value, error }: { name: string; label: string; options: readonly Option[]; placeholder: string; value?: string; error?: string }) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`a-${name}`}>{label}</label>
      <div className="field__box">
        <select id={`a-${name}`} name={name} className="field__input" defaultValue={value ?? ""}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

export function AssistedForm({ services, districts, access, condition, clearance }: {
  services: readonly Option[]; districts: readonly string[]; access: readonly Option[]; condition: readonly Option[]; clearance: readonly Option[];
}) {
  const [state, action] = useActionState(useSafely(createAssistedAction), {} as FormState);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="form-soft">
      <Field name="callerName" label="Who called" defaultValue={v.callerName} error={e.callerName} />
      <Field name="callerPhone" label="Number to call back" type="tel" defaultValue={v.callerPhone} error={e.callerPhone} />
      <Field name="callerRelation" label="Who they are to the farmer" placeholder="For example, the farmer, or their son" defaultValue={v.callerRelation} error={e.callerRelation} />
      <Field name="farmerName" label="Farmer's name" defaultValue={v.farmerName} error={e.farmerName} />
      <Field name="mayAccept" label="Who may accept a quote" defaultValue={v.mayAccept} error={e.mayAccept} />
      <Select name="service" label="Service" options={services} placeholder="Select the work" value={v.service} error={e.service} />
      <Field name="crop" label="Crop (for harvesting)" required={false} defaultValue={v.crop} error={e.crop} />
      <Field name="acres" label="Land size (acres)" inputMode="numeric" defaultValue={v.acres} error={e.acres} />
      <Select name="landAccess" label="Land access" options={access} placeholder="Select" value={v.landAccess} error={e.landAccess} />
      <Select name="landCondition" label="Land condition (optional)" options={condition} placeholder="Select" value={v.landCondition} error={e.landCondition} />
      <Select name="landClearance" label="Land clearance" options={clearance} placeholder="Select" value={v.landClearance} error={e.landClearance} />
      <Select name="district" label="District" options={districts.map((d) => ({ id: d, label: d }))} placeholder="Select a district" value={v.district} error={e.district} />
      <Field name="village" label="Village/town" defaultValue={v.village} error={e.village} />
      <div className={`field${e.preferredDate ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="a-date">Preferred start date</label>
        <div className="field__box"><input id="a-date" name="preferredDate" type="date" className="field__input" defaultValue={v.preferredDate} /></div>
        {e.preferredDate ? <p className="field__error">{e.preferredDate}</p> : null}
      </div>
      <Field name="notes" label="Additional notes" required={false} maxLength={500} defaultValue={v.notes} error={e.notes} />
      <Save />
    </form>
  );
}
