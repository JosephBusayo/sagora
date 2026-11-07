"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BUSINESS_TYPES, DISTRICTS, PRICING_BASES, SERVICES, getBusinessForUser, saveBusiness } from "@/lib/business";
import { addDocument, listDocuments, missingDocuments, removeDocument } from "@/lib/business-documents";
import { flash } from "@/lib/flash";
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
  businessType: z.string().refine((v) => BUSINESS_TYPES.some((t) => t.id === v), "Choose what kind of business this is"),
  authorisedName: z.string().min(2, "Name the person who can offer and allocate your equipment").max(100, "Use 100 characters or fewer"),
  authorisedRole: z.string().min(2, "Say what their role is").max(100, "Use 100 characters or fewer"),
  pricingBasis: z.string().refine((v) => PRICING_BASES.some((p) => p.id === v), "Choose how you price work"),
  includedCosts: z.string().min(3, "Say what your price includes").max(300, "Use 300 characters or fewer"),
  depositTerms: z.string().min(2, "Say what deposit you ask for, or write No deposit").max(300, "Use 300 characters or fewer"),
  cancellationTerms: z.string().min(3, "Say what happens if a farmer or you cancel").max(300, "Use 300 characters or fewer"),
});

/** The form's sections, so a refused submission can say which ones still need work. */
const SECTIONS: [string, string[]][] = [
  ["Business details", ["name", "phone", "email", "businessType"]],
  ["Person in charge", ["authorisedName", "authorisedRole"]],
  ["Where and what", ["district", "town", "services"]],
  ["Prices and terms", ["pricingBasis", "includedCosts", "depositTerms", "cancellationTerms"]],
];

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
    businessType: str(fd, "businessType"),
    authorisedName: str(fd, "authorisedName"),
    authorisedRole: str(fd, "authorisedRole"),
    pricingBasis: str(fd, "pricingBasis"),
    includedCosts: str(fd, "includedCosts"),
    depositTerms: str(fd, "depositTerms"),
    cancellationTerms: str(fd, "cancellationTerms"),
  };
  const values = { ...raw, services: raw.services.join(",") };

  const phone = normaliseSierraLeonePhone(raw.phone);
  if (submit) {
    const parsed = submitSchema.safeParse(raw);
    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    if (!phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
    const own = await getBusinessForUser(user.id);
    const docsMissing = own ? missingDocuments(raw.businessType, await listDocuments(own.id)) : [];
    if (docsMissing.length) fieldErrors.documents = `Add: ${docsMissing.join(", ")}`;
    if (Object.keys(fieldErrors).length) {
      const sections = SECTIONS.filter(([, keys]) => keys.some((k) => fieldErrors[k])).map(([s]) => s);
      if (docsMissing.length) sections.push("Documents");
      return { fieldErrors, values, error: `Not sent yet. Still needed in: ${sections.join(", ")}.` };
    }
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
      businessType: BUSINESS_TYPES.some((t) => t.id === raw.businessType) ? raw.businessType : "",
      authorisedName: raw.authorisedName.slice(0, 100),
      authorisedRole: raw.authorisedRole.slice(0, 100),
      pricingBasis: PRICING_BASES.some((p) => p.id === raw.pricingBasis) ? raw.pricingBasis : "",
      includedCosts: raw.includedCosts.slice(0, 300),
      depositTerms: raw.depositTerms.slice(0, 300),
      cancellationTerms: raw.cancellationTerms.slice(0, 300),
    },
    submit,
  );
  if (!ok) redirect("/provider/setup"); // already submitted or decided: show the status instead
  revalidatePath("/provider/setup");
  if (submit) redirect("/provider/setup");
  return { notice: "Saved. You can come back and finish later." , values };
}

/** A document for the application, sent as soon as it is picked. Saved apart from the form, so nothing typed is lost. */
export async function uploadDocumentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireProvider();
  const result = await addDocument(user.id, str(fd, "kind"), str(fd, "fileName"), str(fd, "file"));
  if (!result.ok) return { error: result.reason };
  revalidatePath("/provider/setup");
  return { notice: "Document added." };
}

export async function removeDocumentAction(fd: FormData) {
  const user = await requireProvider();
  await removeDocument(user.id, str(fd, "id"));
  await flash("Document removed.");
  revalidatePath("/provider/setup");
}
