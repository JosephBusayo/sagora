-- UC08: a provider who needs to see the farm before pricing it. One inspection per provider per
-- request, updated as it moves from needed to booked to done. While it is not done, or done with
-- questions still open, that provider cannot send a quote: an unknown is never priced as if it
-- were the good case.
CREATE TABLE IF NOT EXISTS inspection (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_request(id),
  business_id TEXT NOT NULL REFERENCES provider_business(id),
  status TEXT NOT NULL CHECK (status IN ('required', 'scheduled', 'completed')),
  scheduled_for TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '',
  open_questions TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (request_id, business_id)
);
