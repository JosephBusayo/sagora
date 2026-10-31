"use client";

import { useEffect } from "react";

/**
 * On a phone a table stacks into cards, and each cell needs its column's name beside it. The
 * names are read from the header row, so every table gets this without repeating them. With
 * JavaScript off a table simply scrolls inside its card.
 */
export function TableLabels() {
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>("table.table").forEach((table) => {
        // A heading hidden for screen readers names a column of buttons, which need no label.
        const heads = Array.from(table.querySelectorAll("thead th")).map((th) => (th.querySelector(".sr-only") ? "" : th.textContent?.trim() ?? ""));
        table.querySelectorAll("tbody tr").forEach((row) => {
          Array.from(row.children).forEach((cell, i) => {
            const name = heads[i] ?? "";
            if (cell.getAttribute("data-label") !== name) cell.setAttribute("data-label", name);
          });
        });
      });
      document.documentElement.classList.add("tables-labelled");
    };
    label();
    let queued = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(queued);
      queued = requestAnimationFrame(label);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
