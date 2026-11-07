/**
 * How people reach Sagora without an account: a WhatsApp chat, where they can text or call.
 *
 * SAGORA_WHATSAPP is the number in international form, digits only (for Sierra Leone it starts
 * with 232). Until it is set nothing is shown, rather than a button that goes nowhere.
 */
export function whatsappNumber(): string {
  return (process.env.SAGORA_WHATSAPP ?? "").replace(/\D/g, "");
}

export function whatsappLink(text = "Hello Sagora, I would like to book a farm service."): string | null {
  const n = whatsappNumber();
  if (n.length < 8) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
