import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { pendingEmailChange } from "@/lib/email-change";
import { Shell, PageHead } from "@/components/app/Shell";
import { ChangeEmailCodeForm, ChangeEmailForm } from "@/components/app/email-forms";
import { confirmEmailChangeAction, resendEmailChangeAction, startEmailChangeAction } from "../actions";

export const metadata: Metadata = { title: "Change email" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { user } = await requireWorkspace();
  const waiting = (await searchParams).step === "code" ? await pendingEmailChange(user) : null;
  return (
    <Shell crumb={{ label: "Settings", icon: "settings" }} user={{ name: user.name }}>
      {waiting ? (
        <>
          <PageHead title="Check your new email" subtitle={`Enter the code we sent to ${waiting}`} />
          <ChangeEmailCodeForm action={confirmEmailChangeAction} resendAction={resendEmailChangeAction} closeHref="/provider/settings/account" />
        </>
      ) : (
        <>
          <PageHead title="Change email" subtitle="Change the email address you sign in with" />
          <ChangeEmailForm action={startEmailChangeAction} closeHref="/provider/settings/account" current={user.email} />
        </>
      )}
    </Shell>
  );
}
