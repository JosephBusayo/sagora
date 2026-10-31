export type ToastKind = "success" | "error";

/** Anything in the browser can raise a toast; the Toaster in the root layout shows it. */
export function showToast(message: string, kind: ToastKind = "success") {
  window.dispatchEvent(new CustomEvent("sagora:toast", { detail: { message, kind } }));
}
