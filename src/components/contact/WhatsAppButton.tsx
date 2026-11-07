import { IconBubble3 } from "@central-icons-react/round-filled-radius-2-stroke-2";
import { connection } from "next/server";
import { whatsappLink } from "@/lib/contact";
import styles from "./WhatsAppButton.module.css";

/**
 * Opens a WhatsApp chat with Sagora, where a farmer can text or call someone directly.
 * A plain link: it works without JavaScript and on any phone with WhatsApp.
 */
export async function WhatsAppButton({ inline = false }: { inline?: boolean }) {
  // Read when the page is asked for, not when it was built: setting the number needs no rebuild.
  await connection();
  const href = whatsappLink();
  if (!href) return null;
  return (
    <a className={`${styles.button}${inline ? ` ${styles.inline}` : ""}`} href={href} target="_blank" rel="noopener noreferrer"
      data-testid="whatsapp">
      <IconBubble3 size={22} aria-hidden />
      Speak to us on WhatsApp
    </a>
  );
}
