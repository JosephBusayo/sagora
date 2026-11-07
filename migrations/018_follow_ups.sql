-- UC14: a coordinator's follow-up on anything waiting, keyed by what it is about (for example
-- "unquoted:<request id>"). It records who owns it, the next action and when it is due. It never
-- changes the thing itself: prices, consent and payments stay where they are.
CREATE TABLE IF NOT EXISTS follow_up (
  item_key TEXT PRIMARY KEY,
  owner_id TEXT,
  next_action TEXT NOT NULL DEFAULT '',
  due_on TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Settings staff can change without a deploy: how long something may wait before it counts as
-- overdue, and which accounts are test accounts left out of the business report.
CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
