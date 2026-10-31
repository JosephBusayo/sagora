export type ConfirmRequest = { title: string; body?: string; action: string; resolve: (yes: boolean) => void };

/** Asks in the design's own dialog. Resolves true only if the named action was chosen. */
export function askToConfirm(title: string, action: string, body?: string): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<ConfirmRequest>("sagora:confirm", { detail: { title, body, action, resolve } }));
  });
}
