"use client";

import { PendingButton } from "@/components/app/PendingButton";
import { useState } from "react";
import { Icon } from "@/components/app/Icon";
import { AssetModal } from "./AssetModal";
import { FaultModal } from "./FaultModal";
import { restoreAssetAction, retireAssetAction, resolveFaultAction } from "@/app/provider/(app)/equipment/actions";

export type FaultView = { id: string; severity: "blocking" | "minor"; description: string; reportedAt: string };
export type AssetView = {
  id: string; kind: string; kindLabel: string; name: string; identifier: string;
  ownership: "owned" | "leased"; status: "active" | "retired"; notes: string; retiredReason: string;
  unavailable: string | null; faults: FaultView[];
};
type Option = { id: string; label: string };

export function EquipmentList({ assets, kinds, canEdit }: { assets: AssetView[]; kinds: Option[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<AssetView | null | "new">(null);
  const [faulting, setFaulting] = useState<AssetView | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [show, setShow] = useState("");
  const shown = assets.filter((a) => !show || (show === "available") === !a.unavailable);

  return (
    <>
      <div className="equipment__top">
        <label className="filter">
          <img src="/icons/funnel.svg" alt="" width={20} height={20} />
          <span className="sr-only">Availability</span>
          <select value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="">Filter</option>
            <option value="available">Available</option>
            <option value="unavailable">Not available</option>
          </select>
          <span className="filter__chev" aria-hidden="true"><Icon name="chevron" size={16} /></span>
        </label>
        {canEdit ? (
          <button type="button" className="button button--inline" onClick={() => setEditing("new")}>
            <Icon name="plus" size={18} />
            Add equipment
          </button>
        ) : null}
      </div>

      {assets.length === 0 ? (
        <div className="table-card"><p className="empty">No machines on your register yet.</p></div>
      ) : (
        <div className="equipment-grid">
          {shown.map((a) => (
            <article key={a.id} className={`asset${a.status === "retired" ? " asset--retired" : ""}`}>
              <div className="asset__head">
                <span className="asset__photo" aria-hidden="true"><img src="/icons/plough.svg" alt="" width={44} height={34} /></span>
                <div className="asset__title">
                  <h3>{a.name}</h3>
                  <p>
                    <span><img src="/icons/plough-grey.svg" alt="" width={20} height={15} />{a.kindLabel}</span>
                    <span><Icon name="settings" size={18} />{a.ownership === "owned" ? "Owned" : "Leased"}{a.identifier ? ` · ${a.identifier}` : ""}</span>
                  </p>
                </div>
                {a.unavailable ? (
                  <span className="pill pill--cancelled">{a.unavailable}</span>
                ) : (
                  <span className="pill pill--quotes_sent">Available</span>
                )}
                {canEdit ? (
                  <div className="rowmenu">
                    <button type="button" className="icon-button" aria-haspopup="menu" aria-expanded={menu === a.id}
                      aria-label={`Actions for ${a.name}`} onClick={() => setMenu(menu === a.id ? null : a.id)}>
                      <Icon name="dots" size={18} />
                    </button>
                    {menu === a.id ? (
                      <div className="rowmenu__pop" role="menu">
                        {a.status === "active" ? (
                          <>
                            <button type="button" role="menuitem" onClick={() => { setMenu(null); setEditing(a); }}>Edit details</button>
                            <button type="button" role="menuitem" onClick={() => { setMenu(null); setFaulting(a); }}>Report a fault</button>
                            <form action={retireAssetAction}>
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="reason" value="Taken off the register" />
                              <PendingButton confirm="Retire this machine?" confirmBody="It stays on record but can no longer be used." confirmAction="Retire machine" role="menuitem" className="rowmenu__danger">Retire</PendingButton>
                            </form>
                          </>
                        ) : (
                          <form action={restoreAssetAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <PendingButton role="menuitem">Bring back into service</PendingButton>
                          </form>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {a.status === "retired" && a.retiredReason ? <p className="asset__state"><span className="field__helper">{a.retiredReason}</span></p> : null}

              {a.notes ? <p className="asset__notes">{a.notes}</p> : null}

              {a.faults.length > 0 ? (
                <ul className="asset__faults">
                  {a.faults.map((f) => (
                    <li key={f.id}>
                      <span className={`pill pill--${f.severity === "blocking" ? "cancelled" : "in_progress"}`}>
                        {f.severity === "blocking" ? "Stops work" : "Needs attention"}
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
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <AssetModal asset={editing === "new" ? null : editing} kinds={kinds} onClose={() => setEditing(null)} />
      ) : null}
      {faulting ? <FaultModal asset={faulting} onClose={() => setFaulting(null)} /> : null}
    </>
  );
}
