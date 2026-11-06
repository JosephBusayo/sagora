"use client";

import { CheckFirst } from "@/components/app/CheckFirst";
import { Icon, type IconName } from "@/components/app/Icon";
import { today } from "@/components/app/today";
import { useSafely } from "@/components/app/safely";
import { useActionState, useState } from "react";
import { chiefdomsOf } from "@/lib/chiefdoms";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { LandSizeField } from "@/components/requests/LandSizeField";
import { createAssistedAction } from "@/app/(platform)/staff/assisted-actions";
import type { FormState } from "@/lib/auth-flows";

type Option = { id: string; label: string };

function Save() {
  const { pending } = useFormStatus();
  return <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Create request"}</button>;
}

function Select({ name, label, options, placeholder, value, error, icon, onChange }: {
  name: string; label: string; options: readonly Option[]; placeholder: string; value?: string; error?: string; icon?: IconName;
  onChange?: (value: string) => void;
}) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`a-${name}`}>{label}</label>
      <div className="field__box">
        {icon ? <span className="field__icon" aria-hidden="true"><Icon name={icon} size={18} /></span> : null}
        <select key={value ?? ""} id={`a-${name}`} name={name} className="field__input" defaultValue={value ?? ""} onChange={onChange ? (ev) => onChange(ev.target.value) : undefined}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

export function AssistedForm({ services, districts, access, condition, clearance, submissionKey }: {
  services: readonly Option[]; districts: readonly string[]; access: readonly Option[]; condition: readonly Option[]; clearance: readonly Option[];
  /** Made when the page is drawn, so the same form sent twice makes one request. */
  submissionKey: string;
}) {
  const [state, action] = useActionState(useSafely(createAssistedAction), {} as FormState);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  // The chiefdoms follow the district as soon as it is picked.
  const [picked, setPicked] = useState("");
  const place = picked || v.district || "";
  const chiefdoms = chiefdomsOf(place);
  return (
    <form action={action} className="form-soft">
      <CheckFirst title="Check the request" action="Create request" />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      <Field name="callerName" label="Who called" defaultValue={v.callerName} error={e.callerName} />
      <Field name="callerPhone" label="Number to call back" type="tel" defaultValue={v.callerPhone} error={e.callerPhone} />
      <Field name="callerRelation" label="Who they are to the farmer" placeholder="For example, the farmer, or their son" defaultValue={v.callerRelation} error={e.callerRelation} />
      <Field name="farmerName" label="Farmer's name" defaultValue={v.farmerName} error={e.farmerName} />
      <Field name="mayAccept" label="Who may accept a quote" defaultValue={v.mayAccept} error={e.mayAccept} />
      <Select name="service" label="Service" options={services} placeholder="Select the work" value={v.service} error={e.service} />
      <Field name="crop" label="Crop (for harvesting or planting)" required={false} defaultValue={v.crop} error={e.crop} />
      <LandSizeField id="a-acres" value={v.acres} unit={v.unit} error={e.acres} />
      <Select name="landAccess" label="Land access" options={access} placeholder="Select" value={v.landAccess} error={e.landAccess} />
      <Select name="landCondition" label="Land condition (optional)" options={condition} placeholder="Select" value={v.landCondition} error={e.landCondition} />
      <Select name="landClearance" label="Land clearance" options={clearance} placeholder="Select" value={v.landClearance} error={e.landClearance} />
      <Select icon="pin" name="district" label="District" options={districts.map((d) => ({ id: d, label: d }))} placeholder="Select a district" value={v.district} error={e.district} onChange={setPicked} />
      {chiefdoms.length ? (
        <Select key={place} icon="pin" name="chiefdom" label="Chiefdom" options={chiefdoms.map((c) => ({ id: c, label: c }))} placeholder="Select a chiefdom"
          value={place === v.district ? v.chiefdom : ""} error={e.chiefdom} />
      ) : null}
      <Field icon="pin" name="village" label="Village/town" defaultValue={v.village} error={e.village} />
      <div className={`field${e.preferredDate ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="a-date">Preferred start date</label>
        <div className="field__box"><input id="a-date" name="preferredDate" type="date" min={today()} suppressHydrationWarning className="field__input" defaultValue={v.preferredDate} /></div>
        {e.preferredDate ? <p className="field__error">{e.preferredDate}</p> : null}
      </div>
      <Field name="notes" label="Additional notes" required={false} maxLength={500} defaultValue={v.notes} error={e.notes} />
      <Save />
    </form>
  );
}
