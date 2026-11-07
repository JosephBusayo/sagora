import type { IconName } from "./Icon";

export type NavItem = { href: string; label: string; icon: IconName; adminOnly?: boolean };
export type NavGroup = { title: string; items: NavItem[] };
export type Audience = "provider" | "farmer" | "staff";

/**
 * The sidebar, exactly as the design groups it. Every app shares one component; only this file
 * differs between them, so a change to how navigation looks is made once. Staff have no frame
 * of their own in the design, so theirs follows the same layout with their own pages.
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
          { href: "/farmer/book", label: "Book a service", icon: "requests" },
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
  staff: {
    home: "/staff/providers",
    groups: [
      {
        title: "General",
        items: [
          { href: "/staff/providers", label: "Provider review", icon: "store" },
          { href: "/staff/follow-ups", label: "Follow-ups", icon: "jobs" },
          { href: "/staff/requests", label: "Assisted requests", icon: "requests" },
          { href: "/staff/payments", label: "Payments", icon: "payments" },
          { href: "/staff/outbox", label: "Notification queue", icon: "quotes" },
          { href: "/staff/report", label: "Sagora report", icon: "reports" },
          { href: "/staff/notifications", label: "Notifications", icon: "bell" },
        ],
      },
      {
        title: "Team",
        items: [{ href: "/staff/team", label: "Staff", icon: "team", adminOnly: true }],
      },
    ],
    personal: [
      { href: "/staff/settings", label: "General settings", icon: "settings" },
      { href: "/staff/settings/account", label: "Account", icon: "account" },
    ],
  },
};
