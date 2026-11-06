"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DISTRICTS, SERVICES, saveBusiness } from "@/lib/business";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { requireProvider } from "@/lib/session";
import type { FormState } from "../actions";

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

const serviceIds = SERVICES.map((s) => s.id) as string[];

const submitSchema = z.object({
  name: z.string().min(2, "Enter your business name").max(100, "Use 100 characters or fewer"),
  email: z.string().toLowerCase().pipe(z.email("Enter a valid email address")),
  district: z.enum(DISTRICTS, { error: "Choose your district" }),
  town: z.string().min(2, "Enter your town or village").max(100, "Use 100 characters or fewer"),
  services: z.array(z.string()).min(1, "Choose at least one service"),
  description: z.string().max(500, "Use 500 characters or fewer"),
});

export async function saveSetup(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireProvider(); // the business is always the signed-in provider's own
  const submit = fd.get("intent") === "submit";

  const raw = {
    name: str(fd, "name"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    district: str(fd, "district"),
    town: str(fd, "town"),
    services: fd.getAll("services").filter((s): s is string => typeof s === "string" && serviceIds.includes(s)),
    description: str(fd, "description"),
  };
  const values = { ...raw, services: raw.services.join(",") };

  const phone = normaliseSierraLeonePhone(raw.phone);
  if (submit) {
    const parsed = submitSchema.safeParse(raw);
    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    if (!phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
    if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  } else {
    // Saving for later only needs a business name; the rest can be filled in afterwards.
    if (raw.name.length < 2) return { fieldErrors: { name: "Enter your business name" }, values };
    if (raw.phone && !phone) return { fieldErrors: { phone: "Enter a valid Sierra Leone number, for example 76 123 456" }, values };
  }

  const ok = await saveBusiness(
    user.id,
    {
      name: raw.name,
      phone: phone ?? "",
      email: raw.email.toLowerCase(),
      district: (DISTRICTS as readonly string[]).includes(raw.district) ? raw.district : "",
      town: raw.town,
      services: raw.services,
      description: raw.description,
    },
    submit,
  );
  if (!ok) redirect("/provider/setup"); // already submitted or decided: show the status instead
  revalidatePath("/provider/setup");
  if (submit) redirect("/provider/setup");
  return { notice: "Saved. You can come back and finish later." , values };
}
