"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * The landing page's nav bar, for the quick-request screens (Figma 152:107/267/546 all carry
 * it). The landing's own Nav component can't be reused here: its `.nav` classes are the app
 * sidebar's, and its links are same-page anchors that only exist on the landing page.
 */
const LINKS = {
  howItWorks: "/#how-it-works",
  about: "/#about",
  offer: "/#audience",
  workspace: "/provider/dashboard",
  faq: "/#faq",
  farmerSignIn: "/farmer/sign-in",
  providerSignIn: "/provider/sign-in",
  trySagora: "/request",
};

export function SiteNav() {
  const [open, setOpen] = useState<"providers" | "signIn" | null>(null);
  const wrap = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="site-nav" ref={wrap}>
      <div className="site-nav__inner">
        <Link href="/" className="site-nav__logo" aria-label="Sagora home">
          <img src="/brand/logo-wordmark.svg" alt="Sagora" width={108} height={28} />
        </Link>

        <nav className="site-nav__links" aria-label="Main">
          <a className="site-nav__link" href={LINKS.howItWorks}>How it works</a>
          <a className="site-nav__link" href={LINKS.about}>About Sagora</a>
          <div className="site-nav__drop">
            <button
              type="button"
              className="site-nav__link site-nav__drop-btn"
              aria-expanded={open === "providers"}
              onClick={() => setOpen((v) => (v === "providers" ? null : "providers"))}
            >
              For service providers
              <img src="/img/chevron.svg" alt="" width={24} height={24} className="site-nav__chev" />
            </button>
            {open === "providers" ? (
              <ul className="site-nav__menu">
                <li><a className="site-nav__menu-item" href={LINKS.offer}>Offer your services</a></li>
                <li><a className="site-nav__menu-item" href={LINKS.workspace}>Provider workspace</a></li>
                <li><a className="site-nav__menu-item" href={LINKS.faq}>Provider FAQs</a></li>
              </ul>
            ) : null}
          </div>
        </nav>

        <div className="site-nav__actions">
          <div className="site-nav__drop">
            <button
              type="button"
              className="qr-btn qr-btn--soft"
              aria-expanded={open === "signIn"}
              onClick={() => setOpen((v) => (v === "signIn" ? null : "signIn"))}
            >
              Sign in
            </button>
            {open === "signIn" ? (
              <ul className="site-nav__menu site-nav__menu--end">
                <li><a className="site-nav__menu-item" href={LINKS.farmerSignIn}>As a farmer</a></li>
                <li><a className="site-nav__menu-item" href={LINKS.providerSignIn}>As a service provider</a></li>
              </ul>
            ) : null}
          </div>
          <a className="qr-btn" href={LINKS.trySagora}>Try Sagora</a>
        </div>
      </div>
    </header>
  );
}
