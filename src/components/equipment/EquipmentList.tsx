"use client";

import { EmptyState } from "@/components/app/EmptyState";
import { PendingButton } from "@/components/app/PendingButton";
import { FilterMenu } from "@/components/app/FilterMenu";
import { useModal } from "@/components/app/useModal";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { DOWNTIME_KINDS } from "@/lib/downtime-kinds";
import { landSize } from "@/lib/land-size";
import { Icon } from "@/components/app/Icon";
import { AssetModal } from "./AssetModal";
import { FaultModal } from "./FaultModal";
import {
  addGalleryPhotoAction, cancelDowntimeAction, grantViewerAction, recordDowntimeAction, removeGalleryPhotoAction, resolveFaultAction, restoreAssetAction, retireAssetAction, revokeShareAction, revokeViewerAction, savePairingAction, setAvailabilityAction, setPhotoAction, shareAssetAction,
} from "@/app/(platform)/provider/(app)/equipment/actions";
import { PhotoPicker } from "./PhotoPicker";
import { Field } from "@/components/auth/Field";
import { FormNotice } from "@/components/app/FormNotice";
import { useSafely } from "@/components/app/safely";
import type { FormState } from "@/lib/auth-flows";
import { ZONE } from "@/lib/zone";

/**
 * One fault. `resolvedAt` is null while it is open.
 *
 * `a.faults` carries only the open ones, which is what the card and the Overview tab need;
 * `a.allFaults` carries every one ever recorded, which is what Faults and repairs needs — a
 * machine's fault history is the thing a provider actually wants when deciding whether to keep it.
 */
export type FaultView = {
  id: string; severity: "blocking" | "minor"; description: string; reportedAt: string;
  resolvedAt?: string | null; resolution?: string;
};
export type Readiness = { service: string; summary: string; ready: boolean };
export type PairableService = { id: string; label: string; kinds: string[] };
/** One commitment on a machine's calendar: a quote's hold, a booking, or booked-out downtime. */
export type CommitmentView = {
  kind: string; from: string; to: string; what: string; where: string; committed: boolean;
  /** Set on a downtime row, so the row can carry its own "call it off" control. */
  downtimeId?: string;
};
/** One finished, cancelled or disputed job this machine was on. */
export type PastJobView = { reference: string; what: string; where: string; from: string; to: string; status: string; acres: number | null };
/** One line of assignment activity. Never carries a price — see lib/asset-detail.ts. */
export type ActivityView = { at: string; text: string };
/** A span this machine is deliberately out of action for. */
export type DowntimeView = { id: string; kind: string; kindLabel: string; fromDate: string; toDate: string; reason: string; cancelled: boolean };
/** Another approved provider this machine could be lent to. */
export type ShareableProvider = { id: string; name: string; district: string };
/** Who a machine is currently lent to. */
export type ShareView = { businessId: string; businessName: string; note: string; grantedAt: string };
/** Somebody outside Sagora who may see this machine's utilisation and nothing else. */
export type ViewerView = { email: string; label: string };

export type PairingView = { implementId: string; service: string; verdict: string; basis: string; decidedAt: string };

export type AssetView = {
  pairings: PairingView[];
  /**
   * The three tabs beyond Overview.
   *
   * Loaded with the list rather than on demand, because a provider with a dozen machines opens two
   * or three of them and a round trip per tab would make the window feel broken on a slow
   * connection. If the register ever grows past a page this moves to a route.
   */
  schedule: CommitmentView[];
  history: PastJobView[];
  activity: ActivityView[];
  downtime: DowntimeView[];
  allFaults: FaultView[];
  /** Providers this machine is lent to right now. Empty on almost every machine. */
  shares: ShareView[];
  /** Authorised asset-owner viewers: a donor or lessor who may see this machine's use. */
  viewers: ViewerView[];
  /**
   * The districts this machine has actually worked in, for the district filter.
   *
   * Drawn from its jobs rather than from `location`, which is free text somebody typed, and rather
   * than from the business's coverage, which is where it *could* go. Where it has been is the only
   * one of the three that is a fact.
   */
  districts: string[];
  /* Added with Karim's handover of 23 Nov 2026 — identity, condition, lease and specifications. */
  assetRef: string;
  serialStatus: "recorded" | "unreadable" | "none";
  serialExceptionBy: string;
  condition: "working" | "limited" | "repair" | "retired";
  conditionLabel: string;
  conditionNote: string;
  location: string;
  custodian: string;
  locationAgeDays: number | null;
  lessor: string;
  leaseFrom: string;
  leaseTo: string;
  leaseNotes: string;
  specs: Record<string, string>;
  specRows: { label: string; value: string }[];
  acquiredOn: string;
  supplier: string;
  donor: string;
  useRestrictions: string;
  id: string; kind: string; kindLabel: string; name: string; identifier: string;
  ownership: "owned" | "leased"; status: "active" | "retired"; notes: string; retiredReason: string;
  brand: string; model: string; year: string; horsepower: string; implements: string; services: string[];
  availability: string; unavailable: string | null; faults: FaultView[];
  /** Where this machine stands with Sagora: pending, approved or rejected (migration 035). */
  review: "pending" | "approved" | "rejected";
  /** Why it was rejected, in the reviewer's words. Empty unless it was. */
  reviewNote: string;
  /** Where its photo is served from, or null with no photo yet. */
  photo: string | null;
  /** Further photos, beyond the one cover photo. WAITING-ON (7 Nov): "several equipment photos". */
  gallery: { id: string; src: string }[];
  galleryFull: boolean;
};
type Option = { id: string; label: string };

/**
 * Where this machine stands with Sagora, said plainly.
 *
 * "Do not leave providers guessing whether their equipment upload was successful." The pill above
 * already carries the state; this carries what to do about it — nothing, for one that is being
 * checked, and the reviewer's own words for one that was turned down.
 */
function ReviewState({ a }: { a: AssetView }) {
  if (a.status === "retired" || a.review === "approved") return null;
  // No pill of its own: the one beside the machine's name already carries the state, and two
  // chips saying the same thing is how a card stops being read at all. This is the sentence
  // that says what to do about it.
  if (a.review === "pending") {
    return (
      <p className="asset__review field__helper">
        Sagora is checking this machine. It is saved and you can keep editing it; it can go on a
        quote as soon as it is approved.
      </p>
    );
  }
  return (
    <p className="asset__review field__helper">
      {a.reviewNote || "Sagora did not approve this machine."}
      {" "}Edit it, put that right and save — that sends it back to us.
    </p>
  );
}

/** Green when it can be booked, amber while it is being worked on, red when it cannot be used. */
const pillFor = (a: AssetView) =>
  !a.unavailable ? "quotes_sent" : a.unavailable === "Under maintenance" ? "in_progress" : "cancelled";

/** The line under a machine's name: what it is, and what it pulls or carries. */
function Kind({ a }: { a: AssetView }) {
  return (
    <p>
      <span><img src="/icons/plough-grey.svg" alt="" width={20} height={15} />{a.kindLabel}</span>
      {a.implements || a.identifier ? <span><Icon name="settings" size={18} />{[a.implements, a.identifier].filter(Boolean).join(" · ")}</span> : null}
    </p>
  );
}

function Photo({ size = "card", src }: { size?: "card" | "large" | "small"; src: string | null }) {
  return (
    <span className={`asset__photo asset__photo--${size}`} aria-hidden="true">
      {src ? <img src={src} alt="" className="asset__picture" /> : <img src="/icons/plough.svg" alt="" width={44} height={34} />}
    </span>
  );
}

/** One machine, as the design's details window shows it, with its faults and the ways to change it. */
/**
 * Records one verdict about one machine and one implement, for one service.
 *
 * The service comes first because it decides which implements are even candidates: a plough is
 * offered for ploughing and not for spraying, which saves a provider from recording pairings that
 * could never matter.
 */
function PairingForm({ a, assets, verdicts, services }: {
  a: AssetView; assets: AssetView[]; verdicts: Option[]; services: PairableService[];
}) {
  const [state, action] = useActionState(useSafely(savePairingAction), {} as FormState);
  const [service, setService] = useState(services[0]?.id ?? "");
  const kinds = services.find((x) => x.id === service)?.kinds ?? [];
  const candidates = assets.filter((x) => x.id !== a.id && kinds.includes(x.kind) && x.status !== "retired");

  return (
    <details className="pairings__add">
      <summary>Record a pairing</summary>
      <form action={action} className="form-soft">
        <input type="hidden" name="machineId" value={a.id} />
        <div className="field">
          <label className="field__label" htmlFor={`p-service-${a.id}`}>For which service</label>
          <div className="field__box">
            <select id={`p-service-${a.id}`} name="service" className="field__input"
              value={service} onChange={(ev) => setService(ev.target.value)}>
              {services.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`p-impl-${a.id}`}>With which implement</label>
          <div className="field__box">
            <select id={`p-impl-${a.id}`} name="implementId" className="field__input" defaultValue="">
              <option value="">Choose one</option>
              {candidates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          {candidates.length === 0 ? (
            <p className="field__helper">You have nothing on the register that could do this work. Add it first.</p>
          ) : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`p-verdict-${a.id}`}>Do they fit?</label>
          <div className="field__box">
            <select id={`p-verdict-${a.id}`} name="verdict" className="field__input" defaultValue="compatible">
              {verdicts.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <Field name="basis" label="What you checked" placeholder="eg: Cat 2 hitch measured, needs 70 hp against 90 available" />
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <FormNotice state={state} />
        <PendingButton className="button button--inline">Record it</PendingButton>
      </form>
    </details>
  );
}

/**
 * Lends one machine to one other provider.
 *
 * Deliberately one at a time and from the owner's own machine, rather than a bulk screen: lending a
 * tractor is a real arrangement between two businesses, and the register is where the machine is.
 */
function ShareForm({ a, providers }: { a: AssetView; providers: ShareableProvider[] }) {
  const [state, action] = useActionState(useSafely(shareAssetAction), {} as FormState);
  const free = providers.filter((p) => !a.shares.some((sh) => sh.businessId === p.id));

  if (free.length === 0) {
    return <p className="field__helper">There is nobody else to lend this to yet.</p>;
  }
  return (
    <details className="shares__add">
      <summary>Lend it to another provider</summary>
      <form action={action} className="form-soft">
        <input type="hidden" name="equipmentId" value={a.id} />
        <div className="field">
          <label className="field__label" htmlFor={`sh-to-${a.id}`}>Which provider</label>
          <div className="field__box">
            <select id={`sh-to-${a.id}`} name="toBusinessId" className="field__input" defaultValue="">
              <option value="">Choose one</option>
              {free.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.district}</option>)}
            </select>
          </div>
        </div>
        <Field name="note" label="What you have agreed" required={false}
          placeholder="eg: weekends only, they pay the fuel" />
        <p className="field__helper">
          They can reserve it for their own work, and whoever books the dates first keeps them. They will
          never see your requests, your prices or your farmers — only that the machine is taken, and when.
        </p>
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <FormNotice state={state} />
        <PendingButton className="button button--inline">Lend it</PendingButton>
      </form>
    </details>
  );
}

/**
 * Booking a machine out, and recording work done off Sagora.
 *
 * Karim's handover, 23 November 2026: "Move Record downtime and Record private work inside
 * Equipment. Private work recorded outside the booking flow is a second source of scheduling
 * truth." Private work was already inside the booking flow — it is a job against a request the
 * business owns — so this moves the button to where the machine is rather than rebuilding it.
 *
 * Downtime is new, and the distinction is worth stating: a *condition* of "under repair" says the
 * machine is not available and gives no end date, so nothing can answer a question about next
 * week. Downtime is a span, which can.
 */
function DowntimeSection({ a }: { a: AssetView }) {
  const [state, action] = useActionState(useSafely(recordDowntimeAction), {} as FormState);
  return (
    <section className="downtime">
      {/* No list of its own: the booked-out spans are in the schedule above, in date order among
          the work, each with its own "call it off". This is only the way to add one. */}
      <details className="downtime__add">
        <summary>Book it out</summary>
        <form action={action} className="form-soft">
          <input type="hidden" name="equipmentId" value={a.id} />
          <div className="field">
            <label className="field__label" htmlFor={`dt-kind-${a.id}`}>Why</label>
            <div className="field__box">
              <select id={`dt-kind-${a.id}`} name="kind" className="field__input" defaultValue="service">
                {DOWNTIME_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label className="field__label" htmlFor={`dt-from-${a.id}`}>From</label>
              <div className="field__box">
                <input id={`dt-from-${a.id}`} name="fromDate" type="date" className="field__input" suppressHydrationWarning />
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`dt-to-${a.id}`}>To</label>
              <div className="field__box">
                <input id={`dt-to-${a.id}`} name="toDate" type="date" className="field__input" suppressHydrationWarning />
              </div>
            </div>
          </div>
          <Field name="reason" label="Anything worth noting" required={false} maxLength={200}
            placeholder="eg: 250-hour service at the dealer" />
          <p className="field__helper">
            It will not be offered for work on these days. Work already booked has to be moved first — you
            will be told what is in the way.
          </p>
          {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
          <FormNotice state={state} />
          <PendingButton className="button button--inline">Book it out</PendingButton>
        </form>
      </details>

      {/* The other half of the same handover line. The form itself is unchanged — it already
          creates a job against a request this business owns, which is what keeps private work
          inside the one scheduling truth. */}
      <p className="field__helper">
        Did work for yourself or a neighbour off Sagora?{" "}
        <Link href={`/provider/jobs/new?asset=${a.id}`}>Record private work</Link>, and it will hold
        the machine like any other job.
      </p>
    </section>
  );
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Schedule" },
  { id: "history", label: "Job history" },
  { id: "faults", label: "Faults and repairs" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const day = (iso: string) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB",
    { day: "2-digit", month: "short", year: "numeric", timeZone: ZONE }) : "";

/** A span, said once when it is a single day rather than "14 Dec to 14 Dec". */
const span = (from: string, to: string) => (from === to ? day(from) : `${day(from)} to ${day(to)}`);

/**
 * Where this machine is spoken for.
 *
 * Holds, bookings and downtime in one list, because a provider looking at a calendar does not care
 * which table a commitment lives in. A quote nobody has answered is marked as such: it is the one
 * line here that can still evaporate.
 */
function ScheduleTab({ a, canEdit }: { a: AssetView; canEdit: boolean }) {
  return (
    <>
      {a.schedule.length === 0 ? (
        <p className="field__helper">Nothing booked. This machine is free from today onwards.</p>
      ) : (
        <ul className="timeline">
          {a.schedule.map((c, i) => (
            <li key={`${c.kind}-${c.from}-${i}`} className={`timeline__item timeline__item--${c.kind}`}>
              <span className="timeline__when">{span(c.from, c.to)}</span>
              <span className="timeline__what">
                <strong>{c.what}</strong>
                {c.where ? <span className="field__helper">{c.where}</span> : null}
                {!c.committed ? (
                  <span className="field__helper">Not firm yet — the farmer has not answered.</span>
                ) : null}
              </span>
              {/* The control sits on the row it acts on. Listing booked-out spans again underneath,
                  as the first version did, made one servicing read as two bookings — the same
                  mistake the hold-and-job de-duplication above exists to avoid. */}
              {c.kind === "downtime" && c.downtimeId && canEdit ? (
                <form action={cancelDowntimeAction}>
                  <input type="hidden" name="id" value={c.downtimeId} />
                  <PendingButton className="resend__button">Call it off</PendingButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* "Move Record downtime and Record private work inside Equipment." Both live here now: the
          machine is the thing being committed, so this is where a provider is already looking. */}
      {canEdit && a.status === "active" ? <DowntimeSection a={a} /> : null}
    </>
  );
}

/** What this machine has actually done. The acreage is the figure a provider checks it against. */
function HistoryTab({ a }: { a: AssetView }) {
  if (a.history.length === 0) {
    return <p className="field__helper">No finished work yet. Jobs show here once they are completed or cancelled.</p>;
  }
  return (
    <>
      <ul className="timeline">
        {a.history.map((j, i) => (
          <li key={`${j.reference}-${i}`} className="timeline__item">
            <span className="timeline__when">{span(j.from, j.to)}</span>
            <span className="timeline__what">
              <strong>{j.what}</strong>
              <span className="field__helper">
                {[j.reference, j.where, j.acres ? landSize(j.acres) : ""].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className={`pill pill--${j.status === "completed" ? "completed" : "cancelled"}`}>
              {j.status === "completed" ? "Completed" : j.status === "disputed" ? "Disputed" : "Cancelled"}
            </span>
          </li>
        ))}
      </ul>

      {/* "Show assignment activity for cancellations, replacements and expired holds, with no
          prices shown." Read from the records that caused each event rather than a log somebody has
          to remember to write, so it cannot drift out of step with what happened. */}
      {a.activity.length > 0 ? (
        <details className="activity">
          <summary>Assignment activity</summary>
          <ul className="activity__list">
            {a.activity.map((x, i) => (
              <li key={`${x.at}-${i}`}>
                <span className="field__helper">{day(x.at)}</span>
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

/** Everything ever recorded against it. Nothing is deleted: a machine's history is evidence. */
function FaultsTab({ a, canEdit, onFault }: { a: AssetView; canEdit: boolean; onFault: () => void }) {
  const open = a.allFaults.filter((f) => !f.resolvedAt);
  const fixed = a.allFaults.filter((f) => f.resolvedAt);
  return (
    <>
      {a.allFaults.length === 0 ? (
        <p className="field__helper">Nothing recorded. Report a fault and it stays on this machine&rsquo;s record for good.</p>
      ) : null}
      {open.length > 0 ? (
        <ul className="asset__faults">
          {open.map((f) => (
            <li key={f.id}>
              {/* Severity is said in words as well as coloured: condition must never be carried by
                  colour alone (handover, A16). */}
              <span className={`pill pill--${f.severity === "blocking" ? "cancelled" : "in_progress"}`}>
                {f.severity === "blocking" ? "Out of service" : "Needs attention"}
              </span>
              <span className="asset__fault-text asset__fault-text--stacked">
                <span>{f.description}</span>
                <span className="field__helper">Reported {day(f.reportedAt)}</span>
              </span>
              {canEdit ? (
                <form action={resolveFaultAction}>
                  <input type="hidden" name="faultId" value={f.id} />
                  <input type="hidden" name="resolution" value="Fixed" />
                  <PendingButton className="resend__button">Mark fixed</PendingButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {fixed.length > 0 ? (
        <>
          <h4 className="field__label">Put right</h4>
          <ul className="timeline">
            {fixed.map((f) => (
              <li key={f.id} className="timeline__item">
                <span className="timeline__when">{day(f.resolvedAt ?? f.reportedAt)}</span>
                <span className="timeline__what">
                  <strong>{f.description}</strong>
                  <span className="field__helper">
                    Reported {day(f.reportedAt)}{f.resolution ? ` · ${f.resolution}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {canEdit && a.status === "active" ? (
        <button type="button" className="resend__button asset__report" onClick={onFault}>Report a fault</button>
      ) : null}
    </>
  );
}

/**
 * Grants one person sight of one machine.
 *
 * An email rather than an account, because the people this is for — a programme officer, a
 * lessor's clerk — do not have Sagora logins, and making them sign up to read one number would
 * mean nobody ever uses it.
 */
function ViewerForm({ a }: { a: AssetView }) {
  const [state, action] = useActionState(useSafely(grantViewerAction), {} as FormState);
  return (
    <details className="viewers__add">
      <summary>Give someone access</summary>
      <form action={action} className="form-soft">
        <input type="hidden" name="equipmentId" value={a.id} />
        <Field name="label" label="Who they are" required={false} maxLength={80}
          placeholder="eg: FFSL programme office" />
        <Field name="email" label="Their email address" type="email" placeholder="name@example.org" />
        <p className="field__helper">
          They will see this machine&rsquo;s condition, how many days it has worked and how many days it has
          been out of action. They will not see your farmers, your prices, your other equipment or where
          it is — and they do not need a Sagora account.
        </p>
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <FormNotice state={state} />
        <PendingButton className="button button--inline">Give access</PendingButton>
      </form>
    </details>
  );
}

function DetailsModal({ a, canEdit, availability, assets, verdicts, pairableServices, otherProviders, onClose, onEdit, onFault, onDelete }: {
  a: AssetView; canEdit: boolean; availability: Option[];
  assets: AssetView[]; verdicts: Option[]; pairableServices: PairableService[]; otherProviders: ShareableProvider[];
  onClose: () => void; onEdit: () => void; onFault: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useModal(ref, onClose);
  // "Equipment detail opens to four tabs" — opens to Overview, which is what was already here.
  const [tab, setTab] = useState<Tab>("overview");
  const openFaults = a.allFaults.filter((f) => !f.resolvedAt).length;

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="modal modal--asset" role="dialog" aria-modal="true" aria-label={a.name} ref={ref}>
        {/* The title and the photo stay above the tabs: they say which machine this is, which is
            true on every tab. */}
        {canEdit && a.status === "active" && tab === "overview" ? (
          // Picking a photo sends it at once; the window then shows it.
          <form action={setPhotoAction} className="asset__photo-form" data-saves-itself>
            <input type="hidden" name="id" value={a.id} />
            <PhotoPicker name="photo" label="Photo" current={a.photo} onPicked={(f) => f?.requestSubmit()} />
          </form>
        ) : tab === "overview" ? <Photo size="large" src={a.photo} /> : null}

        {tab === "overview" && (a.gallery.length > 0 || (canEdit && a.status === "active" && !a.galleryFull)) ? (
          <div className="asset__gallery">
            {a.gallery.map((p) => (
              <span key={p.id} className="asset__gallery-item">
                <img src={p.src} alt="" className="asset__picture" />
                {canEdit && a.status === "active" ? (
                  <form action={removeGalleryPhotoAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="photoId" value={p.id} />
                    <PendingButton className="asset__gallery-remove" aria-label="Remove photo"><Icon name="trash" size={14} /></PendingButton>
                  </form>
                ) : null}
              </span>
            ))}
            {canEdit && a.status === "active" && !a.galleryFull ? (
              <form key={a.gallery.length} action={addGalleryPhotoAction} className="asset__gallery-add" data-saves-itself>
                <input type="hidden" name="id" value={a.id} />
                <PhotoPicker name="photo" label="" emptyText="Add another photo" onPicked={(f) => f?.requestSubmit()} />
              </form>
            ) : null}
          </div>
        ) : null}

        <div className="asset__title asset__title--detail">
          <h3>{a.name}</h3>
          <Kind a={a} />
        </div>

        {/* Real buttons in a tablist rather than links, so the whole window is reachable from the
            keyboard and a screen reader is told which panel it is on (A16). */}
        <div className="tabs" role="tablist" aria-label={`${a.name} details`}>
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${a.id}-${t.id}`}
              aria-selected={tab === t.id} aria-controls={`panel-${a.id}-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`tabs__tab${tab === t.id ? " tabs__tab--on" : ""}`}
              onClick={() => setTab(t.id)}
              onKeyDown={(ev) => {
                // Left and right move between tabs, which is what a tablist is expected to do.
                const i = TABS.findIndex((x) => x.id === tab);
                if (ev.key === "ArrowRight") setTab(TABS[(i + 1) % TABS.length]!.id);
                if (ev.key === "ArrowLeft") setTab(TABS[(i - 1 + TABS.length) % TABS.length]!.id);
              }}>
              {t.label}
              {/* The count is said, not coloured: "condition must not be carried by colour alone". */}
              {t.id === "faults" && openFaults > 0 ? <span className="tabs__count">{openFaults}</span> : null}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${a.id}-${tab}`} aria-labelledby={`tab-${a.id}-${tab}`}
          className="tabs__panel">

        {tab === "overview" ? (
        <>
        {/* What the handover asks a register to know about one machine. Each line is omitted when
            there is nothing recorded, so a sparse asset reads as sparse rather than as a wall of
            "Not known". */}
        <dl className="asset__facts">
          {a.assetRef ? <div><dt>Your reference</dt><dd>{a.assetRef}</dd></div> : null}
          {a.identifier ? <div><dt>Serial</dt><dd>{a.identifier}</dd></div> : null}
          {a.serialStatus !== "recorded" ? (
            <div>
              <dt>Serial</dt>
              <dd>
                {a.serialStatus === "unreadable" ? "Plate unreadable" : "Never had one"}
                {a.serialExceptionBy ? " — allowed by review" : " — cannot be quoted until reviewed"}
              </dd>
            </div>
          ) : null}
          <div><dt>Condition</dt><dd>{a.conditionLabel}{a.conditionNote ? ` — ${a.conditionNote}` : ""}</dd></div>
          {a.ownership === "leased" ? (
            <div>
              <dt>Leased</dt>
              <dd>
                {a.lessor ? `from ${a.lessor}` : "from another owner"}
                {a.leaseFrom || a.leaseTo ? `, ${a.leaseFrom || "any time"} to ${a.leaseTo || "no end date"}` : ""}
                {a.leaseNotes ? ` — ${a.leaseNotes}` : ""}
              </dd>
            </div>
          ) : null}
          {a.location || a.custodian ? (
            <div>
              <dt>Last seen</dt>
              <dd>
                {[a.location, a.custodian].filter(Boolean).join(", ")}
                {/* The age is the honest part: Sagora cannot know it has moved since. */}
                {a.locationAgeDays === null ? "" : a.locationAgeDays === 0 ? " — confirmed today"
                  : ` — confirmed ${a.locationAgeDays} ${a.locationAgeDays === 1 ? "day" : "days"} ago`}
              </dd>
            </div>
          ) : null}
          {a.specRows.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
          {a.acquiredOn || a.supplier || a.donor || a.useRestrictions ? (
            <div>
              <dt>Acquired</dt>
              <dd>{[a.acquiredOn, a.supplier, a.donor, a.useRestrictions].filter(Boolean).join(" · ")}</dd>
            </div>
          ) : null}
        </dl>

        {a.status === "retired" ? (
          <p className="asset__state"><span className="pill pill--cancelled">Retired</span>{a.retiredReason ? <span className="field__helper">{a.retiredReason}</span> : null}</p>
        ) : (
          <fieldset className="chips" disabled={!canEdit}>
            <legend className="field__label">Availability status</legend>
            <div className="chips__row">
              {availability.map((o) => (
                <form key={o.id} action={setAvailabilityAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="availability" value={o.id} />
                  <button type="submit" className="chip" aria-pressed={a.availability === o.id}>
                    <span className={`chip__icon${a.availability === o.id ? " chip__icon--on" : ""}`} aria-hidden="true" />
                    {o.label}
                  </button>
                </form>
              ))}
            </div>
          </fieldset>
        )}

        {/* What this machine has been confirmed to work with. A type match is not an approval —
            somebody has to have checked the hitch and the power — so this is where that judgement
            is recorded, with what it rests on. */}
        {a.status === "retired" ? null : (
          <section className="pairings">
            <h4 className="field__label">What this works with</h4>
            {a.pairings.length === 0 ? (
              <p className="field__helper">Nothing recorded yet. Until a pairing is confirmed, the service it belongs to is not ready.</p>
            ) : (
              <ul className="pairings__list">
                {a.pairings.map((p) => {
                  const other = assets.find((x) => x.id === p.implementId);
                  const service = pairableServices.find((x) => x.id === p.service);
                  return (
                    <li key={`${p.implementId}-${p.service}`}>
                      <span className={`pill pill--${p.verdict === "compatible" ? "completed" : p.verdict === "incompatible" ? "cancelled" : "in_progress"}`}>
                        {verdicts.find((v) => v.id === p.verdict)?.label ?? p.verdict}
                      </span>
                      <span className="pairings__text">
                        <strong>{other?.name ?? "Equipment"}</strong>
                        <span className="field__helper">
                          for {(service?.label ?? p.service).toLowerCase()}
                          {p.basis ? ` — ${p.basis}` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit ? <PairingForm a={a} assets={assets} verdicts={verdicts} services={pairableServices} /> : null}
          </section>
        )}

        {/* "A shared asset shares its reservation constraint without sharing business data." Lending
            a machine lets another provider reserve it; it tells them nothing about this business's
            requests, prices or farmers, and when they find it busy they are given the dates and
            nothing else. */}
        {a.status === "retired" || a.ownership === "leased" ? null : (
          <section className="shares">
            <h4 className="field__label">Lent to</h4>
            {a.shares.length === 0 ? (
              <p className="field__helper">Nobody. Only you can put this machine on a quote.</p>
            ) : (
              <ul className="shares__list">
                {a.shares.map((sh) => (
                  <li key={sh.businessId}>
                    <span className="shares__who">
                      <strong>{sh.businessName}</strong>
                      {sh.note ? <span className="field__helper">{sh.note}</span> : null}
                    </span>
                    {canEdit ? (
                      <form action={revokeShareAction}>
                        <input type="hidden" name="equipmentId" value={a.id} />
                        <input type="hidden" name="fromBusinessId" value={sh.businessId} />
                        <PendingButton className="button button--soft">Take it back</PendingButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? <ShareForm a={a} providers={otherProviders} /> : null}
          </section>
        )}

        {/* Open faults used to be listed here and are now on their own tab, with the resolved ones
            for company — a machine's fault history is the thing a provider actually wants when
            deciding whether to keep it. Overview still says the condition, at the top. */}
        {/* A15: "an authorised asset-owner viewer, scoped to named assets only." For the donor or
            lessor who paid for the machine. They see its condition and how many days it has worked;
            they see nothing of this business's customers, prices or other equipment, and they need
            no Sagora account to look. */}
        {a.status === "retired" ? null : (
          <section className="viewers">
            <h4 className="field__label">Who else can see this machine</h4>
            {a.viewers.length === 0 ? (
              <p className="field__helper">
                Nobody outside your business. If a donor or a lessor paid for this machine, you can let
                them see how much it is used — and nothing else.
              </p>
            ) : (
              <ul className="shares__list">
                {a.viewers.map((v) => (
                  <li key={v.email}>
                    <span className="shares__who">
                      <strong>{v.label || v.email}</strong>
                      {v.label ? <span className="field__helper">{v.email}</span> : null}
                    </span>
                    {canEdit ? (
                      <form action={revokeViewerAction}>
                        <input type="hidden" name="equipmentId" value={a.id} />
                        <input type="hidden" name="email" value={v.email} />
                        <PendingButton className="button button--soft">Withdraw</PendingButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? <ViewerForm a={a} /> : null}
          </section>
        )}

        {a.faults.length > 0 ? (
          <p className="field__helper">
            {a.faults.length === 1 ? "There is one open fault" : `There are ${a.faults.length} open faults`} on this
            machine. See <strong>Faults and repairs</strong>.
          </p>
        ) : null}
        </>
        ) : tab === "schedule" ? (
          <ScheduleTab a={a} canEdit={canEdit} />
        ) : tab === "history" ? (
          <HistoryTab a={a} />
        ) : (
          <FaultsTab a={a} canEdit={canEdit} onFault={onFault} />
        )}
        </div>

        {canEdit ? (
          <div className="form-actions">
            {a.status === "active" ? (
              <>
                <button type="button" className="button button--soft" onClick={onDelete}>Delete equipment</button>
                <button type="button" className="button" onClick={onEdit}>Edit</button>
              </>
            ) : (
              <form action={restoreAssetAction} className="form-actions__full">
                <input type="hidden" name="id" value={a.id} />
                <PendingButton className="button">Bring back into service</PendingButton>
              </form>
            )}
          </div>
        ) : (
          <div className="form-actions"><button type="button" className="button" onClick={onClose}>Close</button></div>
        )}
      </div>
    </div>
  );
}

/**
 * The design's delete confirmation. Deleting retires the machine: jobs and agreements still point
 * at it, so it stays on record, marked Retired, and can no longer be put on a job.
 */
function DeleteModal({ a, onClose }: { a: AssetView; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useModal(ref, onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="modal modal--request modal--danger" role="dialog" aria-modal="true" aria-label="Delete equipment" ref={ref}>
        <div className="modal__banner" aria-hidden="true">
          <span className="banner__ring banner__outer" />
          <span className="banner__ring banner__mid" />
          <span className="banner__ring banner__inner"><Icon name="trash" size={34} /></span>
        </div>
        <h2 className="modal__question">Are you sure you want to delete this equipment?</h2>
        <div className="asset__summary">
          <Photo size="small" src={a.photo} />
          <div className="asset__title"><h3>{a.name}</h3><Kind a={a} /></div>
        </div>
        <form action={retireAssetAction} className="form-actions" onSubmit={() => setTimeout(onClose, 0)}>
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="reason" value="Deleted from the register" />
          <button type="button" className="button button--soft" onClick={onClose}>Cancel</button>
          <PendingButton className="button button--danger">Delete equipment</PendingButton>
        </form>
      </div>
    </div>
  );
}

export function EquipmentList({
  assets, kinds, services, availability, serialStates, conditions, readiness, verdicts,
  pairableServices, otherProviders, submissionKey, canEdit,
}: {
  assets: AssetView[]; kinds: Option[]; services: Option[]; availability: Option[];
  serialStates: Option[];
  /** The four condition states, for the filter. Passed in because lib/equipment is server-only. */
  conditions: Option[];
  readiness: Readiness[]; verdicts: Option[]; pairableServices: PairableService[];
  /** Other approved providers, for lending a machine. */
  otherProviders: ShareableProvider[];
  /** Made by the server when the page was drawn, so a retried Add cannot make a second machine. */
  submissionKey: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<AssetView | null | "new">(null);
  const [faulting, setFaulting] = useState<AssetView | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AssetView | null>(null);

  /**
   * "List filters by service, district, condition, ownership and dates; search by serial."
   *
   * Filtered in the browser rather than on the server, because the whole register is already on the
   * page — a provider has a dozen machines, not a thousand — so a round trip per filter would make
   * the screen feel slower for no gain. If a register ever gets big this moves to the query.
   *
   * "Dates" is the one worth explaining: a machine is listed as free on a day if nothing blocks it
   * then, read from the same schedule the capacity check writes. That is what makes this useful
   * rather than decorative — a provider asked for a tractor next Tuesday can answer the question.
   */
  const [show, setShow] = useState("");
  const [service, setService] = useState("");
  const [district, setDistrict] = useState("");
  const [condition, setCondition] = useState("");
  const [ownership, setOwnership] = useState("");
  const [onDate, setOnDate] = useState("");
  const [term, setTerm] = useState("");

  const needle = term.trim().toLowerCase();
  const shown = assets.filter((a) => {
    if (show && (show === "available") !== !a.unavailable) return false;
    if (service && !a.services.includes(service)) return false;
    if (district && !a.districts.includes(district)) return false;
    if (condition && a.condition !== condition) return false;
    if (ownership && a.ownership !== ownership) return false;
    // Busy on the chosen day, by anything: a hold, a booking or downtime.
    if (onDate && a.schedule.some((c) => c.from <= onDate && c.to >= onDate)) return false;
    if (needle) {
      // Serial first, because that is what the handover asks to search by and what is stamped on
      // the machine — but a provider who types a name should not be told there is no such tractor.
      const hay = [a.identifier, a.assetRef, a.name, a.brand, a.model].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const filtered = Boolean(show || service || district || condition || ownership || onDate || needle);
  const open = assets.find((a) => a.id === openId) ?? null;
  const districtsHeld = [...new Set(assets.flatMap((a) => a.districts))].sort();

  return (
    <>
      {/* "Show readiness per service: Ploughing ready, Harrowing missing a harrow, or
          Compatibility needs checking." Worked out from the register, so a provider who has ticked
          a service but owns nothing for it finds out here rather than when a quote is refused. */}
      {readiness.length > 0 ? (
        <ul className="readiness-strip" aria-label="What you are ready for">
          {readiness.map((r) => (
            <li key={r.service} className={r.ready ? "readiness-strip__ok" : "readiness-strip__gap"}>
              <span className="readiness-strip__dot" aria-hidden="true" />
              {r.summary}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="equipment__top">
        <div className="equipment__filters">
          {/* Search is first and widest: a provider standing next to a machine reads the plate. */}
          <div className="field equipment__search">
            <label className="field__label" htmlFor="eq-search">Search</label>
            <div className="field__box">
              <input id="eq-search" type="search" className="field__input" value={term}
                onChange={(ev) => setTerm(ev.target.value)}
                placeholder="Serial, your reference, or a name" />
            </div>
          </div>
          <FilterMenu name="show" label="Availability" icon="/icons/funnel.svg" value={show} onChange={setShow}
            options={[{ value: "", label: "Availability" }, { value: "available", label: "Available" }, { value: "unavailable", label: "Not available" }]} />
          <FilterMenu name="condition" label="Condition" icon="/icons/funnel.svg" value={condition} onChange={setCondition}
            options={[{ value: "", label: "Condition" }, ...conditions.map((c) => ({ value: c.id, label: c.label }))]} />
          <FilterMenu name="ownership" label="Ownership" icon="/icons/funnel.svg" value={ownership} onChange={setOwnership}
            options={[{ value: "", label: "Ownership" }, { value: "owned", label: "Owned" }, { value: "leased", label: "Leased" }]} />
          <FilterMenu name="service" label="Service" icon="/icons/funnel.svg" value={service} onChange={setService}
            options={[{ value: "", label: "Service" }, ...services.map((x) => ({ value: x.id, label: x.label }))]} />
          {districtsHeld.length > 0 ? (
            <FilterMenu name="district" label="District" icon="/icons/pin.svg" value={district} onChange={setDistrict}
              options={[{ value: "", label: "District" }, ...districtsHeld.map((d) => ({ value: d, label: d }))]} />
          ) : null}
          {/* The useful one: free on a given day, read from the same schedule the capacity check
              writes, so the answer here and the answer at quote time cannot differ. */}
          <div className="field equipment__on">
            <label className="field__label" htmlFor="eq-on">Free on</label>
            <div className="field__box">
              <input id="eq-on" type="date" className="field__input" value={onDate}
                suppressHydrationWarning onChange={(ev) => setOnDate(ev.target.value)} />
            </div>
          </div>
          {filtered ? (
            <button type="button" className="button button--soft equipment__clear"
              onClick={() => { setShow(""); setService(""); setDistrict(""); setCondition(""); setOwnership(""); setOnDate(""); setTerm(""); }}>
              Clear
            </button>
          ) : null}
        </div>
        {canEdit ? (
          <button type="button" className="button button--inline" onClick={() => setEditing("new")}>
            <Icon name="plus" size={18} />
            Add equipment
          </button>
        ) : null}
      </div>

      {assets.length === 0 ? (
        <div className="table-card"><EmptyState icon="equipment" title="No equipment yet" body="No equipment on your register yet." /></div>
      ) : shown.length === 0 ? (
        <div className="table-card">
          <EmptyState icon="equipment" title="Nothing matches"
            body={onDate
              ? "No machine is free on that day with those filters. Try another date, or clear the filters."
              : "No machine on your register matches those filters."} />
        </div>
      ) : (
        <div className="equipment-grid">
          {shown.map((a) => (
            <article key={a.id} className={`asset${a.status === "retired" ? " asset--retired" : ""}`}>
              <button type="button" className="asset__open" onClick={() => setOpenId(a.id)} aria-label={`Open ${a.name}`} />
              <div className="asset__head">
                <Photo src={a.photo} />
                <div className="asset__title">
                  <h3>{a.name}</h3>
                  <Kind a={a} />
                </div>
                <span className={`pill pill--${a.status === "retired" ? "cancelled" : pillFor(a)}`}>
                  {a.status === "retired" ? "Retired" : a.unavailable ?? "Available"}
                </span>
              </div>
              {a.faults.some((f) => f.severity === "minor") && a.status === "active" ? (
                <p className="asset__state"><span className="pill pill--in_progress">Needs attention</span></p>
              ) : null}
              <ReviewState a={a} />
            </article>
          ))}
        </div>
      )}

      {open && !editing && !faulting && !deleting ? (
        <DetailsModal a={open} canEdit={canEdit} availability={availability} onClose={() => setOpenId(null)}
          assets={assets} verdicts={verdicts} pairableServices={pairableServices} otherProviders={otherProviders}
          onEdit={() => setEditing(open)} onFault={() => setFaulting(open)} onDelete={() => setDeleting(open)} />
      ) : null}
      {editing ? (
        <AssetModal asset={editing === "new" ? null : editing} kinds={kinds} services={services} availability={availability}
          serialStates={serialStates} submissionKey={submissionKey} onClose={() => setEditing(null)} />
      ) : null}
      {faulting ? <FaultModal asset={faulting} onClose={() => setFaulting(null)} /> : null}
      {deleting ? <DeleteModal a={deleting} onClose={() => { setDeleting(null); setOpenId(null); }} /> : null}
    </>
  );
}
