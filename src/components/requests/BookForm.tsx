"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { bookService } from "@/app/farmer/book/actions";
import type { FormState } from "@/lib/auth-flows";
import { Field } from "@/components/auth/Field";

type Option = { id: string; label: string };

function Submit() {
  const { pending } = useFormStatus();
  return (
    // Our own messages are shown instead of the browser's native tooltips.
    <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>
      {pending ? "Sending…" : "Send request"}
    </button>
  );
}

function Select({ name, label, options, placeholder, error }: {
  name: string; label: string; options: readonly Option[]; placeholder: string; error?: string;
}) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`f-${name}`}>{label}</label>
      <div className="field__box">
        <select id={`f-${name}`} name={name} className="field__input" defaultValue="">
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

function DateField({ name, label, helper, error }: { name: string; label: string; helper?: string; error?: string }) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`f-${name}`}>{label}</label>
      <div className="field__box">
        <input id={`f-${name}`} name={name} type="date" className="field__input" />
      </div>
      {error ? <p className="field__error">{error}</p> : helper ? <p className="field__helper">{helper}</p> : null}
    </div>
  );
}

export function BookForm({ services, districts }: { services: readonly Option[]; districts: readonly string[] }) {
  const [state, action] = useActionState(bookService, {} as FormState);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};

  return (
    <form action={action} className="form-soft book__form">
      <Select name="service" label="What work do you need?" options={services} placeholder="Select the work" error={e.service} />
      <Field name="acres" label="Farm size (acres)" type="text" inputMode="numeric" placeholder="For example, 5" defaultValue={v.acres} error={e.acres} />
      <div className="form-row">
        <DateField name="preferredDate" label="Preferred date" error={e.preferredDate} />
        <DateField name="alternateDate" label="Alternate date" helper="Optional" error={e.alternateDate} />
      </div>
      <Select name="district" label="District" options={districts.map((d) => ({ id: d, label: d }))} placeholder="Select a district" error={e.district} />
      <Field name="village" label="Community or village" placeholder="Where the farm is" defaultValue={v.village} error={e.village} />
      <div className={`field${e.notes ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="f-notes">Anything the provider should know</label>
        <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
          <textarea id="f-notes" name="notes" className="field__input" rows={3} maxLength={500}
            defaultValue={v.notes} placeholder="eg: the land is slightly sloped, has some stumps, needs deep ploughing"
            style={{ resize: "vertical" }} />
        </div>
        {e.notes ? <p className="field__error">{e.notes}</p> : <p className="field__helper">Optional</p>}
      </div>
      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      <Submit />
    </form>
  );
}
