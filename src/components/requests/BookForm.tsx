"use client";

import { Icon, type IconName } from "@/components/app/Icon";
import { today } from "@/components/app/today";
import { useSafely } from "@/components/app/safely";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { bookAsGuest, bookService, type BookState } from "@/app/(platform)/farmer/book/actions";
import { Field } from "@/components/auth/Field";
import { CROP_READINESS, LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION, LAND_TYPE, asksHarvestDetails, extraDetails, landLabel, needsCrop } from "@/lib/land";
import { chiefdomsOf } from "@/lib/chiefdoms";
import { inFieldOrder, serviceLabelOf } from "@/lib/catalogue";
import { landSize, landUnit, toAcres } from "@/lib/land-size";
import { LandSizeField } from "./LandSizeField";
import { clearDraft, restoreDraft, saveDraft } from "@/components/app/draft";
import { ZONE } from "@/lib/zone";

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
        <select key={initial} id={`f-${name}`} name={name} className="field__input" defaultValue={initial} onChange={onChange ? (ev) => onChange(ev.target.value) : undefined}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

/** Every answer, carried to the next submit. */
const FIELDS = ["service", "services", "acres", "unit", "landAccess", "landCondition", "landClearance", "crop", "landType", "cropVariety", "plantedOn", "cropReadiness", "district", "chiefdom", "village", "preferredDate", "alternateDate", "notes"] as const;
/** Asked only of someone without an account: who the request is from, and how to reach them. */
const CONTACT = ["contactName", "contactPhone", "contactEmail"] as const;

const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: ZONE });

function Row({ label, value }: { label: string; value: string }) {
  return <div className="detail-row"><span className="detail-row__label">{label}</span><span className="detail-row__value">{value}</span></div>;
}

/** Step three: what will be sent, to check before it goes. Nothing is saved until then. */
function Summary({ v, serviceName, guest }: { v: Record<string, string>; serviceName: string; guest?: boolean }) {
  const several = (v.services ?? "").includes(",");
  return (
    <div className="detail-list book__summary">
      <Row label={several ? "Services, in order" : "Service"} value={serviceName} />
      <Row label="Land size" value={landSize(toAcres(Number(v.acres), landUnit(v.unit)))} />
      {v.crop ? <Row label="Crop" value={v.crop} /> : null}
      <Row label="Land access" value={landLabel(LAND_ACCESS, v.landAccess)} />
      {v.landCondition ? <Row label="Land condition" value={landLabel(LAND_CONDITION, v.landCondition)} /> : null}
      <Row label="Land clearance" value={landLabel(LAND_CLEARANCE, v.landClearance)} />
      {extraDetails({ service: v.service ?? "", landType: v.landType ?? "", cropVariety: v.cropVariety ?? "", plantedOn: v.plantedOn ?? "", cropReadiness: v.cropReadiness ?? "" })
        .map((x) => <Row key={x.label} label={x.label} value={x.value} />)}
      <Row label="District" value={v.district} />
      {v.chiefdom ? <Row label="Chiefdom" value={v.chiefdom} /> : null}
      <Row label="Village/town" value={v.village} />
      <Row label="Preferred start date" value={longDate(v.preferredDate)} />
      {v.alternateDate ? <Row label="Latest start date" value={longDate(v.alternateDate)} /> : null}
      {v.notes ? <Row label="Additional notes" value={v.notes} /> : null}
      {guest ? (
        <>
          <Row label="Your name" value={v.contactName} />
          <Row label="Your phone number" value={v.contactPhone} />
          {v.contactEmail ? <Row label="Email" value={v.contactEmail} /> : null}
        </>
      ) : null}
    </div>
  );
}

function DateField({ name, label, defaultValue, error, past = false }: { name: string; label: string; defaultValue?: string; error?: string; past?: boolean }) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`f-${name}`}>{label}</label>
      <div className="field__box">
        <span className="field__icon" aria-hidden="true"><Icon name="calendar" size={18} /></span>
        <input id={`f-${name}`} name={name} type="date" min={past ? undefined : today()} max={past ? today() : undefined} suppressHydrationWarning className="field__input" defaultValue={defaultValue} />
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

/**
 * What work the farmer needs: one service, or several done in sequence on the same field.
 *
 * Karim's handover of 23 November 2026 asks for packages — "for a package such as ploughing and
 * harrowing, plan each operation and reserve its resources for its own window" — and the design
 * decision taken on it was that every request is a list and most are lists of one. This is that
 * decision in front of the farmer: tick what you need, and the order is worked out for you.
 *
 * The order is deliberately not the farmer's to set. You cannot harrow a field you have not
 * ploughed, so the sequence comes from the catalogue and the farmer is shown it rather than asked
 * for it. `inFieldOrder` is the same function the server sorts by, which is why what the summary
 * says and what the request stores can never differ.
 *
 * Nor are the dates. One preferred start, and the provider spaces the stages — the gap between
 * ploughing and harrowing depends on the soil and the rain, and asking a farmer to schedule three
 * operations would be asking them to do the provider's job.
 *
 * Two hidden fields go out: `services`, the whole list, and `service`, the stage it leads with. The
 * second is what lets every existing screen, filter and email stay correct without being touched.
 */
function ServicePicker({ options, value, onChange, error }: {
  options: readonly Option[]; value: readonly string[]; onChange: (ids: string[]) => void; error?: string;
}) {
  const toggle = (id: string) =>
    onChange(inFieldOrder(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]));

  return (
    <fieldset className={`chips${error ? " field--invalid" : ""}`}>
      <legend className="field__label">What work do you need?</legend>
      <p className="field__helper">Choose one, or several to be done one after another on the same land.</p>
      <div className="chips__row">
        {options.map((o) => (
          <label key={o.id} className="chip">
            <input type="checkbox" name="services" value={o.id}
              checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
            <span className="chip__icon" aria-hidden="true" />
            {o.label}
          </label>
        ))}
      </div>
      {value.length > 1 ? (
        <p className="field__helper" aria-live="polite">
          In this order: {value.map((id) => serviceLabelOf(id).toLowerCase()).join(", then ")}.
          One provider plans the dates for every stage.
        </p>
      ) : null}
      {/* The stage the request leads with. Carried separately so nothing downstream has to parse
          the list to find it. */}
      <input type="hidden" name="service" value={value[0] ?? ""} />
      {error ? <p className="field__error">{error}</p> : null}
    </fieldset>
  );
}

/** The example fits the work asked for, so a harvesting request is not shown ploughing advice. */
const NOTES_EXAMPLE: Record<string, string> = {
  ploughing: "eg: the land is slightly sloped, has some stumps, needs deep ploughing",
  harvesting: "eg: the rice is ready in two weeks, one end of the field is waterlogged",
  planting: "eg: the land was ploughed last month, we will bring our own seed",
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
export function BookForm({ services, districts, service = "", requestId, initial, direct, submissionKey, guest = false, cancelHref, draftKey }: {
  services: readonly Option[]; districts: readonly string[];
  /** Pre-chosen from the home screen's "Book ploughing" / "Book harvesting" tiles. */
  service?: string;
  /** Set when editing: the same two steps, with the design's "Edit details" words. */
  requestId?: string;
  /** Starting answers, from the request being edited or booked again. */
  initial?: Record<string, string>;
  /** Set when the farmer came from one provider's link. It stays with them. */
  direct?: { id: string; name: string };
  /** Made once when the page is drawn and sent on every step, so a repeated send finds the first request. */
  submissionKey?: string;
  /** Sent without an account: asks for a name and number, and answers with a tracking code. */
  guest?: boolean;
  cancelHref?: string;
  /** Set to keep a half-filled form in the browser under this name, so leaving the page does
   * not throw the answers away. Left unset, nothing is stored. */
  draftKey?: string;
}) {
  const [state, action] = useActionState(useSafely(guest ? bookAsGuest : bookService), {} as BookState);
  const e = state.fieldErrors ?? {};
  // Step one posts the second step's fields as blanks, which must not wipe the saved answers.
  const typed = Object.entries(state.values ?? {}).filter(([, value]) => value !== "");
  const v: Record<string, string> = { ...initial, ...Object.fromEntries(typed) };
  const step = state.step ?? 1;
  // Every stage asked for. A pre-chosen service from a home-screen tile is a list of one, and a
  // request being edited brings its own list back. Held as state so Crop and the harvest questions
  // appear the moment a box is ticked rather than after a round trip.
  const [picked, setPicked] = useState<string[]>(() =>
    inFieldOrder(((v.services ?? service ?? "") as string).split(",").map((x) => x.trim()).filter(Boolean)));
  const work = picked;
  const leadWork = picked[0] ?? "";
  const label = picked.length > 1
    ? picked.map((id) => serviceLabelOf(id).toLowerCase()).join(", then ")
    : services.find((x) => x.id === leadWork)?.label;
  // The chiefdoms follow the district as soon as it is picked.
  const [pickedDistrict, setPickedDistrict] = useState("");
  const place = pickedDistrict || v.district || "";
  const chiefdoms = chiefdomsOf(place);

  // Saved answers go back in once the step is on screen. The form is keyed by step, so this
  // runs again for each one — which is what carries step two's answers through a reload.
  // It also runs again as `work` and `place` become known, because restoring the service and
  // the district is what builds the fields that depend on them: Crop, the harvest questions,
  // the chiefdoms. Restoring only ever fills an empty field, so running again is harmless.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (draftKey && form.current) restoreDraft(draftKey, form.current);
  }, [draftKey, step, leadWork, place]);

  return (
    <form
      key={step}
      ref={form}
      action={action}
      className="form-soft book__form"
      // Every keystroke and every chip, rather than only on moving between steps: the farmer
      // who closes the tab mid-field is the one this is for.
      onInput={() => draftKey && form.current && saveDraft(draftKey, form.current)}
      onChange={() => draftKey && form.current && saveDraft(draftKey, form.current)}
      // The last step is the one that sends it, so the draft has done its job.
      onSubmit={() => { if (draftKey && step === 3) clearDraft(draftKey); }}
    >
      <header className="book__head">
        {step === 3 ? (
          <>
            <h2>Check your request</h2>
            <p>Make sure everything is right before you {requestId ? "save it" : "send it"}.</p>
          </>
        ) : requestId ? (
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
      {submissionKey ? <input type="hidden" name="submissionKey" value={submissionKey} /> : null}

      {step === 1 ? (
        <>
          {(["district", "chiefdom", "village", "preferredDate", "alternateDate", ...(guest ? CONTACT : [])] as const).map((k) => (
            <input key={k} type="hidden" name={k} value={v[k] ?? ""} />
          ))}
          {/* Always shown, even when a home-screen tile pre-chose one service: adding a stage to
              it is exactly what a package is, and hiding the question would hide the feature. */}
          <ServicePicker options={services} value={picked} onChange={setPicked} error={e.service ?? e.services} />
          <LandSizeField value={v.acres} unit={v.unit} error={e.acres} />
          {work.some(needsCrop) ? <Field name="crop" label="Crop" placeholder="For example, rice" maxLength={60} defaultValue={v.crop} error={e.crop} /> : null}
          <Notes value={v.notes} error={e.notes} service={leadWork} />
          <Chips name="landAccess" label="Land access" options={LAND_ACCESS} initial={v.landAccess} error={e.landAccess} />
          <Chips name="landCondition" label="Land condition (optional)" options={LAND_CONDITION} initial={v.landCondition} error={e.landCondition} />
          <Chips name="landClearance" label="Land clearance" options={LAND_CLEARANCE} initial={v.landClearance} error={e.landClearance} />
          <Chips name="landType" label="Is the land upland or lowland? (optional)" options={LAND_TYPE} initial={v.landType} error={e.landType} />
          {work.some(asksHarvestDetails) ? (
            <>
              <Chips name="cropReadiness" label="Is the crop ready to harvest?" options={CROP_READINESS} initial={v.cropReadiness} error={e.cropReadiness} />
              <Field name="cropVariety" label="Variety (leave empty if not sure)" required={false} placeholder="For example, NERICA" maxLength={60} defaultValue={v.cropVariety} error={e.cropVariety} />
              <DateField past name="plantedOn" label="When was it planted? (leave empty if not sure)" defaultValue={v.plantedOn} error={e.plantedOn} />
            </>
          ) : null}
        </>
      ) : step === 2 ? (
        <>
          {(["service", "acres", "unit", "landAccess", "landCondition", "landClearance", "crop", "landType", "cropVariety", "plantedOn", "cropReadiness"] as const).map((k) => (
            <input key={k} type="hidden" name={k} value={v[k] ?? ""} />
          ))}
          {/* One input per stage rather than one comma-joined field, so the server reads this step
              exactly the way it reads the picker on step one. */}
          {picked.map((id) => <input key={id} type="hidden" name="services" value={id} />)}
          <Select icon="pin" name="district" label="District" options={districts.map((d) => ({ id: d, label: d }))} placeholder="Select a district" error={e.district} initial={v.district} onChange={setPickedDistrict} />
          {chiefdoms.length ? (
            <Select key={place} icon="pin" name="chiefdom" label="Chiefdom" options={chiefdoms.map((c) => ({ id: c, label: c }))}
              placeholder="Select a chiefdom" error={e.chiefdom} initial={place === v.district ? v.chiefdom : ""} />
          ) : null}
          <Field icon="pin" name="village" label="Village/town" placeholder="Where the farm is" defaultValue={v.village} error={e.village} />
          <DateField name="preferredDate" label="Preferred start date" defaultValue={v.preferredDate} error={e.preferredDate} />
          <DateField name="alternateDate" label="Latest start date" defaultValue={v.alternateDate} error={e.alternateDate} />
          <Notes value={v.notes} error={e.notes} service={leadWork} />
          {guest ? (
            <>
              <Field name="contactName" label="Your name" placeholder="First and last name" autoComplete="name" maxLength={80} defaultValue={v.contactName} error={e.contactName} />
              <Field name="contactPhone" label="Your phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000" autoComplete="tel-national" defaultValue={v.contactPhone} error={e.contactPhone} />
              <Field name="contactEmail" label="Email" type="email" required={false} placeholder="To get quotes by email" autoComplete="email" defaultValue={v.contactEmail} error={e.contactEmail} />
            </>
          ) : null}
        </>
      ) : (
        <>
          {[...FIELDS, ...(guest ? CONTACT : [])].filter((k) => k !== "services")
            .map((k) => <input key={k} type="hidden" name={k} value={v[k] ?? ""} />)}
          {picked.map((id) => <input key={id} type="hidden" name="services" value={id} />)}
          <Summary v={v} serviceName={label ?? ""} guest={guest} />
        </>
      )}

      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      <div className="form-actions book__actions">
        {step === 3 ? (
          <button type="submit" name="back" value="1" formNoValidate className="button button--soft">Edit details</button>
        ) : (
          <Link href={cancelHref ?? (requestId ? `/farmer/requests/${requestId}` : "/farmer/home")} className="button button--soft">Cancel</Link>
        )}
        <Submit label={step === 3 ? (requestId ? "Save changes" : "Send request") : requestId ? "Next" : "Continue"} />
      </div>
    </form>
  );
}
