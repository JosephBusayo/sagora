import type { Metadata } from "next";
import { PageHead } from "@/components/app/Shell";
import { AccountForm } from "@/components/app/forms";
import { StaffShell } from "@/components/staff/StaffShell";
import { requireStaff } from "@/lib/session";
import { saveStaffAccount } from "../actions";

export const metadata: Metadata = { title: "Account" };

export default async function Page() {
  const staff = await requireStaff();
  return (
    <StaffShell staff={staff} crumb={{ label: "Settings", icon: "settings" }}>
      <PageHead title="Account" subtitle="Manage your personal account details" />
      <AccountForm action={saveStaffAccount} closeHref="/staff/settings"
        initial={{ name: staff.name, phone: (staff.phone ?? "").replace(/^\+232/, ""), email: staff.email }} />
    </StaffShell>
  );
}
