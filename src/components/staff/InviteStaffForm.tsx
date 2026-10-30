"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { inviteStaffAction } from "@/app/staff/team-actions";
import type { FormState } from "@/lib/auth-flows";

function Send() {
  const { pending } = useFormStatus();
  return <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>{pending ? "Sending…" : "Invite"}</button>;
}

export function InviteStaffForm() {
  const [state, action] = useActionState(inviteStaffAction, {} as FormState);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="form-soft">
      <Field name="name" label="Name" defaultValue={v.name} error={e.name} />
      <Field name="email" label="Email" type="email" defaultValue={v.email} error={e.email} />
      <div className="field">
        <label className="field__label" htmlFor="staff-role">Role</label>
        <div className="field__box">
          <select id="staff-role" name="role" className="field__input" defaultValue={v.role ?? "staff"}>
            <option value="staff">Staff</option>
            <option value="admin">Admin (can also add and remove staff)</option>
          </select>
        </div>
      </div>
      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      {state.notice ? <p className="notice notice--success staff-link" role="status">{state.notice}</p> : null}
      <Send />
    </form>
  );
}
