"use client";

import { Icon, type IconName } from "@/components/app/Icon";
import { today } from "@/components/app/today";
import { useSafely } from "@/components/app/safely";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { bookService, type BookState } from "@/app/farmer/book/actions";
import { Field } from "@/components/auth/Field";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION } from "@/lib/land";

type Option = { id: string; label: string };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    // Our own messages are shown instead of the browser's native tooltips.
    <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>
      {pending ? "Sending…" : label}
    </button>
  );
}

function Select({ name, label, options, placeholder, error, initial = "", icon, onChange }: {
  name: string; label: string; options: readonly Option[]; placeholder: string; error?: string; initial?: string; icon?: IconName;
  onChange?: (value: string) => void;
}) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`f-${name}`}>{label}</label>
      <div className="field__box">
        {icon ? <span className="field__icon" aria-hidden="true"><Icon name={icon} size={18} /></span> : null}
        <select id={`f-${name}`} name={name} className="field__input" defaultValue={initial} onChange={onChange ? (ev) => onChange(ev.target.value) : undefined}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

function DateField({ name, label, defaultValue, error }: { name: string; label: string; defaultValue?: string; error?: string }) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`f-${name}`}>{label}</label>
      <div className="field__box">
        <span className="field__icon" aria-hidden="true"><Icon name="calendar" size={18} /></span>
        <input id={`f-${name}`} name={name} type="date" min={today()} suppressHydrationWarning className="field__input" defaultValue={defaultValue} />
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

function Chips({ name, label, options, initial, error }: {
  name: string; label: string; options: readonly Option[]; initial?: string; error?: string;
}) {
  return (
    <fieldset className={`chips${error ? " field--invalid" : ""}`}>
      <legend className="field__label">{label}</legend>
      <div className="chips__row">
        {options.map((o) => (
          <label key={o.id} className="chip">
            <input type="radio" name={name} value={o.id} defaultChecked={initial === o.id} />
            <span className="chip__icon" aria-hidden="true" />
            {o.label}
          </label>
        ))}
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </fieldset>
  );
}

/** The example fits the work asked for, so a harvesting request is not shown ploughing advice. */
const NOTES_EXAMPLE: Record<string, string> = {
  ploughing: "eg: the land is slightly sloped, has some stumps, needs deep ploughing",
  harvesting: "eg: the rice is ready in two weeks, one end of the field is waterlogged",
};

function Notes({ value, error, service }: { value?: string; error?: string; service?: string }) {
  return (
    <Field name="notes" label="Additional notes" required={false} maxLength={500} defaultValue={value} error={error}
      placeholder={NOTES_EXAMPLE[service ?? ""] ?? "eg: the land is slightly sloped and has some stumps"} />
  );
}

/**
 * Two steps, as the design draws them (465:11158, 465:11454). Each step is a real submit and the
 * first step's answers travel as hidden fields, so the flow works with JavaScript off.
 */
export function BookForm({ services, districts, service = "", requestId, initial, direct }: {
  services: readonly Option[]; districts: readonly string[];
  /** Pre-chosen from the home screen's "Book ploughing" / "Book harvesting" tiles. */
  service?: string;
  /** Set when editing: the same two steps, with the design's "Edit details" words. */
  requestId?: string;
  /** Starting answers, from the request being edited or booked again. */
  initial?: Record<string, string>;
  /** Set when the farmer came from one provider's link. It stays with them. */
  direct?: { id: string; name: string };
}) {
  const [state, action] = useActionState(useSafely(bookService), {} as BookState);
  const e = state.fieldErrors ?? {};
  // Step one posts the second step's fields as blanks, which must not wipe the saved answers.
  const typed = Object.entries(state.values ?? {}).filter(([, value]) => value !== "");
  const v: Record<string, string> = { ...initial, ...Object.fromEntries(typed) };
  const step = state.step ?? 1;
  const chosen = v.service ?? service;
  const label = services.find((s) => s.id === chosen)?.label;
  // Picked from the drop-down before any submit: Crop shows at once rather than after a round trip.
  const [picked, setPicked] = useState("");
  const work = chosen || picked;

  return (
    <form key={step} action={action} className="form-soft book__form">
      <header className="book__head">
        {requestId ? (
          <>
            <h2>Edit details</h2>
            <p>Edit details of your request</p>
          </>
        ) : label ? (
          <>
            <h2>{label} service</h2>
            <p>Tell us about your {label.toLowerCase()} needs</p>
          </>
        ) : <h2>Book a service</h2>}
        {direct ? <p>Request to {direct.name}</p> : null}
      </header>
      <input type="hidden" name="step" value={step} />
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
      {direct ? <input type="hidden" name="directTo" value={direct.id} /> : null}

      {step === 1 ? (
        <>
          {label ? <input type="hidden" name="service" value={chosen} /> : (
            <Select name="service" label="What work do you need?" options={services} placeholder="Select the work" error={e.service} onChange={setPicked} />
          )}
          <div className={`field${e.acres ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="f-acres">Land size</label>
            <div className="field__box">
              <input id="f-acres" name="acres" className="field__input" inputMode="numeric" placeholder="Land size" defaultValue={v.acres} />
              <span className="field__suffix">Acres</span>
            </div>
            {e.acres ? <p className="field__error">{e.acres}</p> : null}
          </div>
          {work === "harvesting" ? <Field name="crop" label="Crop" placeholder="For example, rice" maxLength={60} defaultValue={v.crop} error={e.crop} /> : null}
          <Notes value={v.notes} error={e.notes} service={work} />
          <Chips name="landAccess" label="Land access" options={LAND_ACCESS} initial={v.landAccess} error={e.landAccess} />
          <Chips name="landCondition" label="Land condition (optional)" options={LAND_CONDITION} initial={v.landCondition} error={e.landCondition} />
          <Chips name="landClearance" label="Land clearance" options={LAND_CLEARANCE} initial={v.landClearance} error={e.landClearance} />
        </>
      ) : (
        <>
          {(["service", "acres", "landAccess", "landCondition", "landClearance", "crop"] as const).map((k) => (
            <input key={k} type="hidden" name={k} value={v[k] ?? ""} />
          ))}
          <Select icon="pin" name="district" label="District" options={districts.map((d) => ({ id: d, label: d }))} placeholder="Select a district" error={e.district} initial={v.district} />
          <Field icon="pin" name="village" label="Village/town" placeholder="Where the farm is" defaultValue={v.village} error={e.village} />
          <DateField name="preferredDate" label="Preferred start date" defaultValue={v.preferredDate} error={e.preferredDate} />
          <DateField name="alternateDate" label="Latest start date" defaultValue={v.alternateDate} error={e.alternateDate} />
          <Notes value={v.notes} error={e.notes} service={work} />
        </>
      )}

      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      <div className="form-actions book__actions">
        <Link href={requestId ? `/farmer/requests/${requestId}` : "/farmer/home"} className="button button--soft">Cancel</Link>
        <Submit label={step === 1 ? (requestId ? "Next" : "Continue") : requestId ? "Save changes" : "Send request"} />
      </div>
    </form>
  );
}
