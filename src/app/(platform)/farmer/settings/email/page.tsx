import type { Metadata } from "next";
import { requireFarmer } from "@/lib/session";
import { pendingEmailChange } from "@/lib/email-change";
import { unreadCount } from "@/lib/notifications";
import { Shell, PageHead } from "@/components/app/Shell";
import { ChangeEmailCodeForm, ChangeEmailForm } from "@/components/app/email-forms";
import { confirmEmailChangeAction, resendEmailChangeAction, startEmailChangeAction } from "../actions";

export const metadata: Metadata = { title: "Change email" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const farmer = await requireFarmer();
  const waiting = (await searchParams).step === "code" ? await pendingEmailChange(farmer) : null;
  return (
    <Shell crumb={{ label: "Settings", icon: "settings" }} user={{ name: farmer.name }} audience="farmer" unread={await unreadCount(farmer)}>
      {waiting ? (
        <>
          <PageHead title="Check your new email" subtitle={`Enter the code we sent to ${waiting}`} />
          <ChangeEmailCodeForm action={confirmEmailChangeAction} resendAction={resendEmailChangeAction} closeHref="/farmer/settings/account" />
        </>
      ) : (
        <>
          <PageHead title="Change email" subtitle="Change the email address you sign in with" />
          <ChangeEmailForm action={startEmailChangeAction} closeHref="/farmer/settings/account" current={farmer.email} />
        </>
      )}
    </Shell>
  );
}
