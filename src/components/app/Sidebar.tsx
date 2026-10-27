"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

type Item = { href: string; label: string; icon: IconName };

/** Exactly the three groups in the Figma sidebar. */
const GENERAL: Item[] = [
  { href: "/provider/dashboard", label: "Dashboard", icon: "home" },
  { href: "/provider/requests", label: "Requests", icon: "requests" },
  { href: "/provider/quotes", label: "My quotes", icon: "quotes" },
  { href: "/provider/jobs", label: "Jobs", icon: "jobs" },
  { href: "/provider/equipment", label: "Equipment", icon: "equipment" },
  { href: "/provider/payments", label: "Payments", icon: "payments" },
  { href: "/provider/notifications", label: "Notifications", icon: "bell" },
];
const TEAM: Item[] = [
  { href: "/provider/team", label: "Team", icon: "team" },
  { href: "/provider/reports", label: "Reports", icon: "reports" },
];
const PERSONAL: Item[] = [
  { href: "/provider/settings", label: "General settings", icon: "settings" },
  { href: "/provider/help", label: "Help & support", icon: "help" },
  { href: "/provider/settings/account", label: "Account", icon: "account" },
];

function Group({ title, items, pathname }: { title: string; items: Item[]; pathname: string }) {
  return (
    <div className="nav__group">
      <p className="nav__title">{title}</p>
      <ul className="nav__list">
        {items.map((i) => {
          const active = pathname === i.href || (i.href !== "/provider/settings" && pathname.startsWith(i.href + "/"));
          return (
            <li key={i.href}>
              <Link href={i.href} className={`nav__item${active ? " nav__item--active" : ""}`} aria-current={active ? "page" : undefined}>
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

export function Sidebar({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/provider/dashboard" className="nav__brand">
        <Icon name="logo" />
        <span>Sagora</span>
      </Link>
      <Group title="General" items={GENERAL} pathname={pathname} />
      <Group title="Team" items={TEAM} pathname={pathname} />
      <div className="nav__spacer" />
      <div className="nav__group">
        <p className="nav__title">Personal</p>
        <ul className="nav__list">
          {PERSONAL.map((i) => {
            const active = pathname === i.href;
            return (
              <li key={i.href}>
                <Link href={i.href} className={`nav__item${active ? " nav__item--active" : ""}`} aria-current={active ? "page" : undefined}>
                  <Icon name={i.icon} />
                  <span>{i.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <form action={signOutAction}>
              <button type="submit" className="nav__item nav__item--button">
                <Icon name="logout" />
                <span>Logout</span>
              </button>
            </form>
          </li>
        </ul>
      </div>
    </nav>
  );
}
