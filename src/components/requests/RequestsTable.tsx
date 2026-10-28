"use client";

import { useState } from "react";
import { Icon } from "@/components/app/Icon";
import { RequestModal, type RequestDetail } from "./RequestModal";
import type { MyQuote } from "./QuoteForm";

export type RequestRow = RequestDetail & { statusLabel: string; status: string; myQuote: MyQuote | null };

export function RequestsTable({ rows }: { rows: RequestRow[] }) {
  const [open, setOpen] = useState<RequestRow | null>(null);
  if (rows.length === 0) {
    return (
      <div className="table-card">
        <p className="empty">No requests match these filters yet.</p>
      </div>
    );
  }
  return (
    <>
      <div className="table-card">
        <table className="table table--requests">
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Service</th>
              <th scope="col">Location</th>
              <th scope="col">Farm size</th>
              <th scope="col">Preferred date</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="table__person">
                    <span className="request-icon" aria-hidden="true">
                      <Icon name={r.service === "harvesting" ? "quotes" : "equipment"} size={22} />
                    </span>
                    <span>{r.reference}</span>
                  </span>
                </td>
                <td>{r.serviceLabel}</td>
                <td>{r.district}</td>
                <td>{r.acres} acres</td>
                <td>{r.preferredDate}</td>
                <td><span className={`pill pill--${r.status}`}>{r.statusLabel}</span></td>
                <td className="table__actions">
                  <button type="button" className="icon-button" onClick={() => setOpen(r)} aria-label={`Open request ${r.reference}`}>
                    <Icon name="chevron" size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? <RequestModal request={open} myQuote={open.myQuote} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
