import "server-only";
import { listForReview } from "./business";
import { counts } from "./outbox";
import { equipmentPendingCount } from "./equipment";
import { openCases } from "./payments";
import { openDisputes, openPayoutRequests, pendingReleases } from "./settlement";

export type WaitingItem = { id: string; count: number; title: string; body: string; href: string };

/**
 * What is waiting on staff right now: the bell's count and the Notifications page. Each line
 * is a queue another staff screen already shows, so this only counts and points to it.
 */
export async function waitingOnStaff(): Promise<{ items: WaitingItem[]; total: number }> {
  const [review, cases, disputes, releases, withdrawals, outbox, machines] = await Promise.all([
    listForReview(), openCases(), openDisputes(), pendingReleases(), openPayoutRequests(), counts(),
    equipmentPendingCount(),
  ]);
  const items: WaitingItem[] = [
    { id: "review", count: review.length, title: "Providers waiting for review", body: "New businesses to approve, send back or reject.", href: "/staff/providers" },
    // A machine a provider registered this morning is work nobody else is going to notice:
    // their business was approved months ago, so nothing else about them appears in any queue.
    { id: "equipment", count: machines, title: "Equipment waiting for approval", body: "Machines a provider registered that nobody has checked.", href: "/staff/providers" },
    { id: "disputes", count: disputes.length, title: "Disputed jobs", body: "Farmers who raised a concern about the work.", href: "/staff/payments?tab=disputes" },
    { id: "cases", count: cases.length, title: "Payment cases", body: "Payments that need someone to look at them.", href: "/staff/payments?tab=cases" },
    { id: "releases", count: releases.length + withdrawals.length, title: "Money out", body: "Payouts and refunds to approve or send.", href: "/staff/payments?tab=releases" },
    { id: "outbox", count: outbox.failed, title: "Messages that gave up", body: "Emails that could not be sent.", href: "/staff/outbox" },
  ];
  return { items, total: items.reduce((n, i) => n + i.count, 0) };
}
