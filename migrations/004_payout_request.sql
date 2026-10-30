-- A provider asking for the money already owed to them. It moves nothing: the ledger only changes
-- when staff send a release, which still needs two people. One open request per business.
CREATE TABLE IF NOT EXISTS payout_request (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  business_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','closed')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS payout_request_open ON payout_request (business_id) WHERE status = 'requested';
