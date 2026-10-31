import Link from "next/link";

export const PAGE_LENGTH = 20;

/** One page of a list that has already been read and is short enough to hold. */
export function pageOf<T>(rows: T[], asked: string | undefined) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_LENGTH));
  const page = Math.min(Math.max(1, Number(asked) || 1), pages);
  return { rows: rows.slice((page - 1) * PAGE_LENGTH, page * PAGE_LENGTH), page, pages };
}

export function Pager({ page, pages, path }: { page: number; pages: number; path: string }) {
  return (
    <nav className="pager" aria-label="Pages">
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) =>
        p === page ? (
          <span key={p} className="is-current" aria-current="page">{p}</span>
        ) : (
          <Link key={p} href={p === 1 ? path : `${path}?page=${p}`}>{p}</Link>
        ),
      )}
    </nav>
  );
}
