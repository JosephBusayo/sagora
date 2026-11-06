-- One row per Monime checkout Sagora opens for a farmer. The amount is what Sagora asked for,
-- fixed when the checkout was made; Monime's own record is fetched again before anything is
-- recorded, so a notice that only claims a payment never moves money on its own.
CREATE TABLE IF NOT EXISTS monime_checkout (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  test_mode INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  redirect_url TEXT NOT NULL,
  order_number TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS monime_checkout_request ON monime_checkout (request_id, created_at);
CREATE INDEX IF NOT EXISTS monime_checkout_status ON monime_checkout (status, created_at);
