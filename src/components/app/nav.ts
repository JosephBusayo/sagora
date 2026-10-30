import type { IconName } from "./Icon";

export type NavItem = { href: string; label: string; icon: IconName };
export type NavGroup = { title: string; items: NavItem[] };
export type Audience = "provider" | "farmer";

/**
 * The sidebar, exactly as the design groups it. Both apps share one component; only this file
 * differs between them, so a change to how navigation looks is made once.
 */
export const NAV: Record<Audience, { home: string; groups: NavGroup[]; personal: NavItem[] }> = {
  provider: {
    home: "/provider/dashboard",
    groups: [
      {
        title: "General",
        items: [
          { href: "/provider/dashboard", label: "Dashboard", icon: "home" },
          { href: "/provider/requests", label: "Requests", icon: "requests" },
          { href: "/provider/quotes", label: "My quotes", icon: "quotes" },
          { href: "/provider/jobs", label: "Jobs", icon: "jobs" },
          { href: "/provider/equipment", label: "Equipment", icon: "equipment" },
          { href: "/provider/payments", label: "Payments", icon: "payments" },
          { href: "/provider/notifications", label: "Notifications", icon: "bell" },
        ],
      },
      {
        title: "Team",
        items: [
          { href: "/provider/team", label: "Team", icon: "team" },
          { href: "/provider/reports", label: "Reports", icon: "reports" },
        ],
      },
    ],
    personal: [
      { href: "/provider/settings", label: "General settings", icon: "settings" },
      { href: "/provider/help", label: "Help & support", icon: "help" },
      { href: "/provider/settings/account", label: "Account", icon: "account" },
    ],
  },
  farmer: {
    home: "/farmer/home",
    groups: [
      {
        title: "General",
        items: [
          { href: "/farmer/home", label: "Home", icon: "home" },
          { href: "/farmer/book", label: "Book a service", icon: "plus" },
          { href: "/farmer/requests", label: "My requests", icon: "requests" },
          { href: "/farmer/bookings", label: "My bookings", icon: "jobs" },
          { href: "/farmer/payments", label: "Payments", icon: "payments" },
          { href: "/farmer/notifications", label: "Notifications", icon: "bell" },
        ],
      },
    ],
    personal: [
      { href: "/farmer/settings", label: "General settings", icon: "settings" },
      { href: "/farmer/help", label: "Help & support", icon: "help" },
      { href: "/farmer/settings/account", label: "Account", icon: "account" },
    ],
  },
};
