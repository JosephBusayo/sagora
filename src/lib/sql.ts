/**
 * `?` → `$1, $2 …` for PostgreSQL, skipping anything inside a quoted string so a literal
 * question mark in someone's note is never mistaken for a parameter.
 *
 * Deliberately not "server-only": the browser tests need it too, to talk to whichever database
 * the suite is running against.
 */
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) {
        // A doubled quote is an escaped one, so the string carries on.
        if (sql[i + 1] === quote) out += sql[++i];
        else quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      continue;
    }
    out += c === "?" ? `$${++n}` : c;
  }
  return out;
}
