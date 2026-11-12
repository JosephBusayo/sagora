import Image from "next/image";
import Link from "next/link";
import { WhatsAppButton } from "@/components/contact/WhatsAppButton";
import { nudge } from "@/lib/outbox";

/** The frame for pages a farmer uses without an account: the logo home, the page, and WhatsApp. */
export function GuestShell({ children, hideHeader = false }: { children: React.ReactNode; hideHeader?: boolean }) {
  nudge();
  return (
    <div className="guest">
      {hideHeader ? null : (
        <header className="guest__bar">
          <Link href="/" aria-label="Sagora home"><Image src="/brand/logo-mark.svg" alt="Sagora" width={44} height={41} priority /></Link>
          <Link href="/farmer/sign-in" className="guest__signin">Have an account? Sign in</Link>
        </header>
      )}
      <main className="guest__main">{children}</main>
      <div className="guest__help">
        <WhatsAppButton inline />
      </div>
    </div>
  );
}
