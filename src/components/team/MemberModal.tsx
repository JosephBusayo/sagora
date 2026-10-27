"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import type { FormState } from "@/app/provider/actions";
import { editMember, inviteMember } from "@/app/provider/(app)/team/actions";
import type { Row } from "./TeamTable";

type Option = { id: string; label: string };
type Props = {
  mode: "invite" | "edit";
  member?: Row;
  roles: Option[];
  permissions: Option[];
  onClose: () => void;
};

function Select({ name, label, options, placeholder, defaultValue, error }: {
  name: string; label: string; options: Option[]; placeholder: string; defaultValue?: string; error?: string;
}) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`sel-${name}`}>{label}</label>
      <div className="field__box">
        <select id={`sel-${name}`} name={name} className="field__input" defaultValue={defaultValue ?? ""}>
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

function Buttons({ label, onClose }: { label: string; onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="form-actions">
      <button type="button" className="button button--soft" onClick={onClose} disabled={pending}>Cancel</button>
      <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>{pending ? "Please wait…" : label}</button>
    </div>
  );
}

export function MemberModal({ mode, member, roles, permissions, onClose }: Props) {
  const action = mode === "invite" ? inviteMember : editMember;
  const [state, formAction] = useActionState(action, {} as FormState);
  const ref = useRef<HTMLDivElement>(null);
  const done = Boolean(state.notice);

  // Close once the server confirms, and allow Escape at any time.
  useEffect(() => {
    if (done) {
      const t = setTimeout(onClose, 900);
      return () => clearTimeout(t);
    }
  }, [done, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, select")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const val = (k: string, fallback = "") => v[k] ?? fallback;

  return (
    <div className="modal-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <div className="modal__head">
          <h2 id="modal-title">{mode === "invite" ? "Invite team member" : "Edit team member"}</h2>
          <p>{mode === "invite" ? "Add someone to your business and set their permissions" : "Update team member details and permissions"}</p>
        </div>
        <form action={formAction} className="form-soft">
          {member ? <input type="hidden" name="id" value={member.id} /> : null}
          <Field name="name" label="Full name" placeholder="Salieu Jalloh" autoComplete="name" defaultValue={val("name", member?.name ?? "")} error={e.name} />
          <Field name="phone" label="Phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000" autoComplete="tel-national"
            defaultValue={val("phone", (member?.phone ?? "").replace(/^\+232/, ""))} error={e.phone} />
          <Field name="email" label="Email address" type="email" inputMode="email" placeholder="abc@gmail.com" autoComplete="email"
            defaultValue={val("email", member?.email ?? "")} error={e.email} />
          <div className="form-row">
            <Select name="role" label="Role" options={roles} placeholder="Select role" defaultValue={val("role", member?.role ?? "")} error={e.role} />
            <Select name="permission" label="Permissions" options={permissions} placeholder="Select permissions" defaultValue={val("permission", member?.permission ?? "")} error={e.permission} />
          </div>
          {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
          {state.notice ? <p className="notice notice--success" role="status">{state.notice}</p> : null}
          <Buttons label={mode === "invite" ? "Send invitation" : "Save changes"} onClose={onClose} />
        </form>
      </div>
    </div>
  );
}
