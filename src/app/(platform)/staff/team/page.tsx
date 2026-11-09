import { PendingButton } from "@/components/app/PendingButton";
import { StaffShell } from "@/components/staff/StaffShell";
import { PageHead } from "@/components/app/Shell";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { listStaff, openInvites } from "@/lib/staff";
import { InviteStaffForm } from "@/components/staff/InviteStaffForm";
import { cancelInviteAction, removeStaffAction, setFinanceAccessAction } from "../team-actions";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/** No Figma frame exists for this: built from the staff screens' existing look. */
export default async function Page() {
  const admin = await requireAdmin();
  const staff = await listStaff();
  const invites = await openInvites();

  return (
    <StaffShell staff={admin} crumb={{ label: "Staff", icon: "team" }}>
        <PageHead title="Staff" />
        <section className="staff__item">
          <h2>Invite someone</h2>
          <InviteStaffForm />
        </section>
        <section className="staff__item">
          <h2>Current staff</h2>
          <ul className="asset__faults">
            {staff.map((s) => (
              <li key={s.id}>
                <span className="asset__fault-text">
                  {s.name} · {s.email} · {s.role === "admin" ? "Admin" : "Staff"}
                  {" · "}{s.role === "admin" || s.financeAccess ? "Finance desk" : "No finance access"}
                </span>
                {s.role === "admin" ? null : (
                  <form action={setFinanceAccessAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="allowed" value={s.financeAccess ? "false" : "true"} />
                    <PendingButton className="resend__button">{s.financeAccess ? "Take away finance access" : "Give finance access"}</PendingButton>
                  </form>
                )}
                {s.id === admin.id ? null : (
                  <form action={removeStaffAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <PendingButton confirm="Remove this person from staff?" confirmBody="Their access ends immediately." confirmAction="Remove from staff" className="resend__button">Remove</PendingButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
        {invites.length > 0 ? (
          <section className="staff__item">
            <h2>Invitations waiting</h2>
            <ul className="asset__faults">
              {invites.map((i) => (
                <li key={i.id}>
                  <span className="asset__fault-text">{i.name} · {i.email}</span>
                  <form action={cancelInviteAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <PendingButton className="resend__button">Cancel</PendingButton>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
    </StaffShell>
  );
}
