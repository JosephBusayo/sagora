import type { Metadata } from "next";
import { PageHead } from "@/components/app/Shell";
import { PasswordForm } from "@/components/app/forms";
import { StaffShell } from "@/components/staff/StaffShell";
import { requireStaff } from "@/lib/session";
import { changeStaffPassword } from "../actions";

export const metadata: Metadata = { title: "Password and security" };

export default async function Page() {
  const staff = await requireStaff();
  return (
    <StaffShell staff={staff} crumb={{ label: "Settings", icon: "settings" }}>
      <PageHead title="Password and security" subtitle="Manage your password" />
      <PasswordForm action={changeStaffPassword} closeHref="/staff/settings" />
    </StaffShell>
  );
}
