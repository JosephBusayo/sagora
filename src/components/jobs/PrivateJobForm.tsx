"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { createPrivateJobAction } from "@/app/provider/(app)/jobs/actions";
import { SoftForm } from "@/components/app/SoftForm";
import { Field } from "@/components/auth/Field";

type Option = { id: string; label: string };

function Save() {
  const { pending } = useFormStatus();
  return <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Add job"}</button>;
}

function Select({ name, label, options, placeholder, value, error }: {
  name: string; label: string; options: readonly Option[]; placeholder: string; value?: string; error?: string;
}) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`p-${name}`}>{label}</label>
      <div className="field__box">
        <select id={`p-${name}`} name={name} className="field__input" defaultValue={value ?? ""}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

export function PrivateJobForm({ services, districts }: { services: readonly Option[]; districts: readonly string[] }) {
  return (
    <SoftForm action={createPrivateJobAction}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        const v = s.values ?? {};
        return (
          <>
            <Field name="customerName" label="Customer name" defaultValue={v.customerName} error={e.customerName} />
            <Field name="customerPhone" label="Customer phone" required={false} defaultValue={v.customerPhone} error={e.customerPhone} helper="Optional" />
            <Select name="service" label="Service" options={services} placeholder="Select the work" value={v.service} error={e.service} />
            <Field name="acres" label="Land size (acres)" inputMode="numeric" defaultValue={v.acres} error={e.acres} />
            <Select name="district" label="District" options={districts.map((d) => ({ id: d, label: d }))} placeholder="Select a district" value={v.district} error={e.district} />
            <Field name="village" label="Village/town" defaultValue={v.village} error={e.village} />
            <Field name="notes" label="Additional notes" required={false} defaultValue={v.notes} error={e.notes} maxLength={500} />
            <div className="form-actions">
              <Link href="/provider/jobs" className="button button--soft" style={{ display: "grid", placeItems: "center" }}>Cancel</Link>
              <Save />
            </div>
          </>
        );
      }}
    </SoftForm>
  );
}
