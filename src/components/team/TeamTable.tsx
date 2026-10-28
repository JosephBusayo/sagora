"use client";

import { useState } from "react";
import { Icon } from "@/components/app/Icon";
import { MemberModal } from "./MemberModal";
import { removeTeamMember } from "@/app/provider/(app)/team/actions";

export type Row = {
  id: string; name: string; phone: string; email: string;
  role: string; roleLabel: string; permission: string; permissionLabel: string;
  status: "invited" | "active" | "removed";
};
type Option = { id: string; label: string };

export function TeamTable({ rows, roles, permissions }: { rows: Row[]; roles: Option[]; permissions: Option[] }) {
  const [editing, setEditing] = useState<Row | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  return (
    <>
      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Permissions</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>
                  <span className="table__person">
                    <span className="table__avatar" aria-hidden="true"><Icon name="user" size={22} /></span>
                    <span>{m.name}</span>
                  </span>
                </td>
                <td>{m.roleLabel}</td>
                <td>{m.permissionLabel}</td>
                <td>
                  <span className={`pill pill--${m.status}`}>{m.status === "active" ? "Active" : "Invited"}</span>
                </td>
                <td className="table__actions">
                  {m.role === "owner" ? null : (
                    <div className="rowmenu">
                      <button type="button" className="icon-button" aria-haspopup="menu" aria-expanded={menu === m.id}
                        aria-label={`Actions for ${m.name}`} onClick={() => setMenu(menu === m.id ? null : m.id)}>
                        <Icon name="dots" size={18} />
                      </button>
                      {menu === m.id ? (
                        <div className="rowmenu__pop" role="menu">
                          <button type="button" role="menuitem" onClick={() => { setMenu(null); setEditing(m); }}>Edit member</button>
                          <form action={removeTeamMember}>
                            <input type="hidden" name="id" value={m.id} />
                            <button type="submit" role="menuitem" className="rowmenu__danger">Remove from team</button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="empty">No one has been added yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editing ? (
        <MemberModal mode="edit" member={editing} roles={roles} permissions={permissions} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}
