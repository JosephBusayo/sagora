"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { drain, retry } from "@/lib/outbox";

export async function retryMessageAction(fd: FormData) {
  await requireStaff();
  retry(String(fd.get("id") ?? ""));
  await drain();
  revalidatePath("/staff/outbox");
}

export async function drainNowAction() {
  await requireStaff();
  await drain();
  revalidatePath("/staff/outbox");
}
