/**
 * Points the command-line tools at Neon's *direct* connection instead of the pooled one.
 *
 * Neon hands out two connection strings for the same database. The pooled one (its hostname
 * carries a `-pooler` suffix) goes through PgBouncer in transaction mode and is what the
 * website should use. The direct one is what schema changes, dumps and anything relying on
 * session state must use: over a pooled connection those fail in ways that never mention
 * pooling — a SET that does not survive past its own transaction, so the next statement
 * reports a table that plainly exists as missing.
 *
 * `neon env pull` writes them as DATABASE_URL and DATABASE_URL_UNPOOLED. Every script that
 * changes or administers the schema calls this first, before importing the data layer, so the
 * application keeps its pool and the tools get a plain connection. On a plain Postgres server
 * there is no second URL and nothing changes.
 */
export function preferDirectConnection(): void {
  const direct = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (direct) process.env.DATABASE_URL = direct;
}
