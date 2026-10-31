"use client";

import { PendingButton } from "@/components/app/PendingButton";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { NAV, type Audience, type NavItem } from "./nav";

function Group({ title, items, pathname, exact }: { title: string; items: NavItem[]; pathname: string; exact: boolean }) {
  return (
    <div className="nav__group">
      <p className="nav__title">{title}</p>
      <ul className="nav__list">
        {items.map((i) => {
          // "Settings" would otherwise light up on every page beneath it.
          const isSettings = i.href.endsWith("/settings");
          const active = exact || isSettings ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + "/");
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                className={`nav__item${active ? " nav__item--active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={i.icon} />
                <span>{i.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sidebar({ audience, signOutAction }: { audience: Audience; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const nav = NAV[audience];
  return (
    <nav className="nav" aria-label="Main">
      {/* A checkbox rather than state, so the phone menu opens with JavaScript off. The key
          closes it again after moving to another page. */}
      <input key={pathname} id="nav-open" type="checkbox" className="nav__toggle" aria-label="Menu" />
      <div className="nav__bar">
        <Link href={nav.home} className="nav__brand">
          <Image src="/brand/logo-wordmark.svg" alt="Sagora" width={108} height={28} priority />
        </Link>
        <label htmlFor="nav-open" className="nav__burger" aria-hidden="true">
          <span /><span /><span />
        </label>
      </div>
      <div className="nav__body">
      {nav.groups.map((g) => (
        <Group key={g.title} title={g.title} items={g.items} pathname={pathname} exact={false} />
      ))}
      <div className="nav__spacer" />
      <div className="nav__group">
        <p className="nav__title">Personal</p>
        <ul className="nav__list">
          {nav.personal.map((i) => {
            const active = pathname === i.href;
            return (
              <li key={i.href}>
                <Link
                  href={i.href}
                  className={`nav__item${active ? " nav__item--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={i.icon} />
                  <span>{i.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <form action={signOutAction}>
              <PendingButton className="nav__item nav__item--button">
                <Icon name="logout" />
                <span>Logout</span>
              </PendingButton>
            </form>
          </li>
        </ul>
      </div>
      </div>
    </nav>
  );
}
