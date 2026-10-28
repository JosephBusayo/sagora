import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/**
 * Opens the test database the same way the app does. The busy timeout matters: the server
 * holds the write lock while it works, and node:sqlite waits 0ms by default, so without this
 * a test write fails outright with "database is locked".
 */
export function openTestDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "test.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
