import Link from "next/link";
import { listForReview } from "@/lib/business";

/** The way around the staff screens, with what is waiting on them. */
export async function StaffNav({ current, role }: { current: "providers" | "payments" | "outbox" | "team"; role?: string | null }) {
  const waiting = (await listForReview()).length;
  const items = [
    { id: "providers", href: "/staff/providers", label: waiting > 0 ? `Provider review (${waiting})` : "Provider review" },
    { id: "payments", href: "/staff/payments", label: "Payments" },
    { id: "outbox", href: "/staff/outbox", label: "Notification queue" },
    ...(role === "admin" ? [{ id: "team", href: "/staff/team", label: "Staff" }] : []),
  ];
  return (
    <nav className="tabs tabs--page" aria-label="Staff">
      {items.map((i) => (
        <Link key={i.id} href={i.href} className={`tab${i.id === current ? " tab--on" : ""}`} aria-current={i.id === current ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
