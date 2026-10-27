"use client";

import { useState } from "react";
import { Icon } from "@/components/app/Icon";
import { MemberModal } from "./MemberModal";

type Option = { id: string; label: string };

export function InviteButton({ roles, permissions }: { roles: Option[]; permissions: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button button--inline" onClick={() => setOpen(true)}>
        <Icon name="plus" size={18} />
        Invite team member
      </button>
      {open ? <MemberModal mode="invite" roles={roles} permissions={permissions} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
