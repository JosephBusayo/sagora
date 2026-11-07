"use server";

import { flash } from "@/lib/flash";
import { revalidatePath } from "next/cache";
import { siteUrl } from "@/lib/site";
import { z } from "zod";
import { requireWorkspace } from "@/lib/guard";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { notify } from "@/lib/outbox";
import { PERMISSIONS, ROLES, createInvite, removeMember, updateMember, updateOperatorDetails } from "@/lib/team";
import type { FormState } from "@/app/(platform)/provider/actions";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
const roleIds = ROLES.map((r) => r.id) as string[];
const permIds = PERMISSIONS.map((p) => p.id) as string[];
const emailSchema = z.string().toLowerCase().pipe(z.email("Enter a valid email address"));

function parse(fd: FormData) {
  const name = str(fd, "name");
  const email = str(fd, "email");
  const role = str(fd, "role");
  const permission = str(fd, "permission");
  const rawPhone = str(fd, "phone");
  const phone = normaliseSierraLeonePhone(rawPhone);

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Enter their full name";
  if (!phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
  if (!emailSchema.safeParse(email).success) fieldErrors.email = "Enter a valid email address";
  if (!roleIds.includes(role)) fieldErrors.role = "Choose a role";
  if (!permIds.includes(permission)) fieldErrors.permission = "Choose permissions";
  // Only the business itself can have an owner, so an invite can never create a second one.
  if (role === "owner") fieldErrors.role = "A business has one owner. Choose another role.";

  return {
    fieldErrors,
    values: { name, phone: rawPhone, email, role, permission },
    input: { name, phone: phone ?? "", email: email.toLowerCase(), role, permission },
  };
}

export async function inviteMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission !== "full_access") return { error: "You do not have permission to invite people." };

  const { fieldErrors, values, input } = parse(fd);
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const created = await createInvite(business.id, user.id, input);
  if (!created) return { error: "That person is already on your team or has already been invited.", values };

  const base = siteUrl();
  await notify({
    kind: "team.invited",
    dedupeKey: `team.invited:${created.id}`,
    to: input.email,
    subject: `${business.name} invited you to Sagora`,
    text:
      `${user.name} invited you to join ${business.name} on Sagora as ${input.role}.\n\n` +
      `Accept the invitation here (the link works once and expires in 7 days):\n${base}/provider/join/${created.token}\n\n` +
      `If you were not expecting this, you can ignore this email.`,
  });

  revalidatePath("/provider/team");
  return { notice: `Invitation sent to ${input.email}.` };
}

export async function editMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission !== "full_access") return { error: "You do not have permission to change the team." };

  const id = str(fd, "id");
  const { fieldErrors, values, input } = parse(fd);
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const skills = str(fd, "skills").slice(0, 200);
  const awayFrom = str(fd, "awayFrom");
  const awayTo = str(fd, "awayTo");
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if ((awayFrom || awayTo) && (!iso.test(awayFrom) || !iso.test(awayTo))) return { fieldErrors: { awayTo: "Give both the first and last day away" }, values: { ...values, skills, awayFrom, awayTo } };
  if (awayFrom && awayTo < awayFrom) return { fieldErrors: { awayTo: "The last day must be on or after the first" }, values: { ...values, skills, awayFrom, awayTo } };

  if (!await updateMember(business.id, user.id, id, input)) {
    return { error: "We couldn't save those changes.", values };
  }
  await updateOperatorDetails(business.id, user.id, id, { skills, awayFrom, awayTo });
  revalidatePath("/provider/team");
  return { notice: "Team member updated." };
}

export async function removeTeamMember(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission !== "full_access") return;
  await removeMember(business.id, user.id, str(fd, "id"));
  await flash("Removed from the team.");
  revalidatePath("/provider/team");
}
