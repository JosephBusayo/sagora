import "server-only";
import { cookies } from "next/headers";

/** A short message for the next screen, for actions that have no form to answer on. */
export async function flash(message: string, kind: "success" | "error" = "success") {
  (await cookies()).set("sagora_flash", JSON.stringify({ message, kind }), { path: "/", maxAge: 30, sameSite: "lax" });
}
