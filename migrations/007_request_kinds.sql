-- What a request can be besides a farmer's own general request.
-- crop: what is being harvested. direct_to: the one business a direct request stays with.
-- assisted_by and the caller fields: a coordinator took this over the phone, for a farmer with no
-- account, and may_accept names who is allowed to accept a quote.
ALTER TABLE service_request ADD COLUMN crop TEXT NOT NULL DEFAULT '';
ALTER TABLE service_request ADD COLUMN direct_to TEXT;
ALTER TABLE service_request ADD COLUMN assisted_by TEXT;
ALTER TABLE service_request ADD COLUMN caller_name TEXT NOT NULL DEFAULT '';
ALTER TABLE service_request ADD COLUMN caller_relation TEXT NOT NULL DEFAULT '';
ALTER TABLE service_request ADD COLUMN may_accept TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS service_request_direct ON service_request (direct_to);

-- Every call about an assisted request, and how it went.
CREATE TABLE IF NOT EXISTS request_contact (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS request_contact_request ON request_contact (request_id, created_at);
