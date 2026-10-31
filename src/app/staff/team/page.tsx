import { StaffNav } from "@/components/staff/StaffNav";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import { listStaff, openInvites } from "@/lib/staff";
import { signOut } from "@/app/provider/actions";
import { InviteStaffForm } from "@/components/staff/InviteStaffForm";
import { cancelInviteAction, removeStaffAction } from "../team-actions";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/** No Figma frame exists for this: built from the staff screens' existing look. */
export default async function Page() {
  const admin = await requireAdmin();
  const staff = await listStaff();
  const invites = await openInvites();

  return (
    <main className="setup">
      <div className="setup__card setup__card--wide">
        <StaffNav current="team" role={admin.role} />
        <h1 className="auth__title">Staff</h1>
        <section className="staff__item">
          <h2>Invite someone</h2>
          <InviteStaffForm />
        </section>
        <section className="staff__item">
          <h2>Current staff</h2>
          <ul className="asset__faults">
            {staff.map((s) => (
              <li key={s.id}>
                <span className="asset__fault-text">{s.name} · {s.email} · {s.role === "admin" ? "Admin" : "Staff"}</span>
                {s.id === admin.id ? null : (
                  <form action={removeStaffAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" className="resend__button">Remove</button>
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
                    <button type="submit" className="resend__button">Cancel</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <form action={signOut} className="setup__signout"><button type="submit" className="resend__button">Sign out</button></form>
      </div>
    </main>
  );
}
