/** After a failed submit, takes the person to the first field that needs fixing. */
export function focusFirstError(form: HTMLFormElement | null | undefined) {
  form?.querySelector<HTMLElement>(".field--invalid input:not([type=hidden]), .field--invalid select, .field--invalid textarea")?.focus();
}
