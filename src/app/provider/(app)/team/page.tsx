import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { TeamTable, type Row } from "@/components/team/TeamTable";
import { InviteButton } from "@/components/team/InviteButton";
import { PERMISSIONS, ROLES, ensureOwner, listMembers, permissionLabel, roleLabel } from "@/lib/team";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, business, permission } = await requireWorkspace();
  ensureOwner(business.id, user);

  const rows: Row[] = listMembers(business.id).map((m) => ({
    id: m.id, name: m.name, phone: m.phone, email: m.email,
    role: m.role, roleLabel: roleLabel(m.role),
    permission: m.permission, permissionLabel: permissionLabel(m.permission),
    status: m.status,
  }));
  const roles = ROLES.filter((r) => r.id !== "owner").map((r) => ({ ...r }));
  const permissions = PERMISSIONS.map((p) => ({ ...p }));

  return (
    <Shell crumb={{ label: "Team", icon: "team" }} user={{ name: user.name }}>
      <PageHead
        title="Team management"
        subtitle="Manage the people who work with you"
        action={permission === "full_access" ? <InviteButton roles={roles} permissions={permissions} /> : null}
      />
      <TeamTable rows={rows} roles={roles} permissions={permissions} />
    </Shell>
  );
}
