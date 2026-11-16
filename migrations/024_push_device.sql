-- Phones registered for notifications. One row per device, keyed by the token Firebase gives
-- it, so the same person signing in on two phones is told on both.
--
-- A token is not a secret and not stable: Firebase reissues it, and a reinstall produces a new
-- one. Rows are therefore disposable - anything Firebase rejects as gone is deleted rather than
-- retried, and nothing here is needed to make the app work.
CREATE TABLE IF NOT EXISTS push_device (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_device_user ON push_device (user_id);
