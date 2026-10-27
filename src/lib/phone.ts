/**
 * Sierra Leone phone numbers: country code +232, then 8 digits.
 * Accepts "76 123 456", "076123456", "+232 76 123 456", "23276123456".
 * Returns "+23276123456", or null when it can't be a valid number.
 */
export function normaliseSierraLeonePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00232")) digits = digits.slice(5);
  else if (digits.startsWith("232")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^\d{8}$/.test(digits) ? `+232${digits}` : null;
}

/** "+23276123456" -> "+232 •• ••• 456" (for showing a number without exposing it). */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)} •• ••• ${e164.slice(-3)}`;
}
