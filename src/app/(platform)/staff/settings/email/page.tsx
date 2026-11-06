import type { Metadata } from "next";
import { requireStaff } from "@/lib/session";
import { pendingEmailChange } from "@/lib/email-change";
import { PageHead } from "@/components/app/Shell";
import { StaffShell } from "@/components/staff/StaffShell";
import { ChangeEmailCodeForm, ChangeEmailForm } from "@/components/app/email-forms";
import { confirmEmailChangeAction, resendEmailChangeAction, startEmailChangeAction } from "../actions";

export const metadata: Metadata = { title: "Change email" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const staff = await requireStaff();
  const waiting = (await searchParams).step === "code" ? await pendingEmailChange(staff) : null;
  return (
    <StaffShell staff={staff} crumb={{ label: "Settings", icon: "settings" }}>
      {waiting ? (
        <>
          <PageHead title="Check your new email" subtitle={`Enter the code we sent to ${waiting}`} />
          <ChangeEmailCodeForm action={confirmEmailChangeAction} resendAction={resendEmailChangeAction} closeHref="/staff/settings/account" />
        </>
      ) : (
        <>
          <PageHead title="Change email" subtitle="Change the email address you sign in with" />
          <ChangeEmailForm action={startEmailChangeAction} closeHref="/staff/settings/account" current={staff.email} />
        </>
      )}
    </StaffShell>
  );
}
