"use client";

import { EmptyState } from "@/components/app/EmptyState";
import { PendingButton } from "@/components/app/PendingButton";
import { FilterMenu } from "@/components/app/FilterMenu";
import { useModal } from "@/components/app/useModal";
import { useRef, useState } from "react";
import { Icon } from "@/components/app/Icon";
import { AssetModal } from "./AssetModal";
import { FaultModal } from "./FaultModal";
import { restoreAssetAction, retireAssetAction, resolveFaultAction, setAvailabilityAction, setPhotoAction } from "@/app/(platform)/provider/(app)/equipment/actions";
import { PhotoPicker } from "./PhotoPicker";

export type FaultView = { id: string; severity: "blocking" | "minor"; description: string; reportedAt: string };
export type AssetView = {
  id: string; kind: string; kindLabel: string; name: string; identifier: string;
  ownership: "owned" | "leased"; status: "active" | "retired"; notes: string; retiredReason: string;
  brand: string; model: string; year: string; horsepower: string; implements: string; services: string[];
  availability: string; unavailable: string | null; faults: FaultView[];
  /** Where its photo is served from, or null with no photo yet. */
  photo: string | null;
};
type Option = { id: string; label: string };

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
function DetailsModal({ a, canEdit, availability, onClose, onEdit, onFault, onDelete }: {
  a: AssetView; canEdit: boolean; availability: Option[];
  onClose: () => void; onEdit: () => void; onFault: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useModal(ref, onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="modal modal--asset" role="dialog" aria-modal="true" aria-label={a.name} ref={ref}>
        {canEdit && a.status === "active" ? (
          // Picking a photo sends it at once; the window then shows it.
          <form action={setPhotoAction} className="asset__photo-form" data-saves-itself>
            <input type="hidden" name="id" value={a.id} />
            <PhotoPicker name="photo" label="Photo" current={a.photo} onPicked={(f) => f?.requestSubmit()} />
          </form>
        ) : <Photo size="large" src={a.photo} />}
        <div className="asset__title asset__title--detail">
          <h3>{a.name}</h3>
          <Kind a={a} />
        </div>

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

        {a.faults.length > 0 ? (
          <ul className="asset__faults">
            {a.faults.map((f) => (
              <li key={f.id}>
                <span className={`pill pill--${f.severity === "blocking" ? "cancelled" : "in_progress"}`}>
                  {f.severity === "blocking" ? "Out of service" : "Needs attention"}
                </span>
                <span className="asset__fault-text">{f.description}</span>
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

        {canEdit && a.status === "active" ? (
          <button type="button" className="resend__button asset__report" onClick={onFault}>Report a fault</button>
        ) : null}

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

export function EquipmentList({ assets, kinds, services, availability, canEdit }: {
  assets: AssetView[]; kinds: Option[]; services: Option[]; availability: Option[]; canEdit: boolean;
}) {
  const [editing, setEditing] = useState<AssetView | null | "new">(null);
  const [faulting, setFaulting] = useState<AssetView | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AssetView | null>(null);
  const [show, setShow] = useState("");
  const shown = assets.filter((a) => !show || (show === "available") === !a.unavailable);
  const open = assets.find((a) => a.id === openId) ?? null;

  return (
    <>
      <div className="equipment__top">
        <FilterMenu name="show" label="Availability" icon="/icons/funnel.svg" value={show} onChange={setShow}
          options={[{ value: "", label: "Filter" }, { value: "available", label: "Available" }, { value: "unavailable", label: "Not available" }]} />
        {canEdit ? (
          <button type="button" className="button button--inline" onClick={() => setEditing("new")}>
            <Icon name="plus" size={18} />
            Add equipment
          </button>
        ) : null}
      </div>

      {assets.length === 0 ? (
        <div className="table-card"><EmptyState icon="equipment" title="No equipment yet" body="No equipment on your register yet." /></div>
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
            </article>
          ))}
        </div>
      )}

      {open && !editing && !faulting && !deleting ? (
        <DetailsModal a={open} canEdit={canEdit} availability={availability} onClose={() => setOpenId(null)}
          onEdit={() => setEditing(open)} onFault={() => setFaulting(open)} onDelete={() => setDeleting(open)} />
      ) : null}
      {editing ? (
        <AssetModal asset={editing === "new" ? null : editing} kinds={kinds} services={services} availability={availability} onClose={() => setEditing(null)} />
      ) : null}
      {faulting ? <FaultModal asset={faulting} onClose={() => setFaulting(null)} /> : null}
      {deleting ? <DeleteModal a={deleting} onClose={() => { setDeleting(null); setOpenId(null); }} /> : null}
    </>
  );
}
