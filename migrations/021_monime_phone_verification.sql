-- WAITING-ON #2 (7 Nov): the design's "Monime — Verify account" step sends a code to the Monime
-- phone number before Sagora saves it as a payout destination. One pending code per business —
-- a new request to the same business replaces whichever is still outstanding.
CREATE TABLE IF NOT EXISTS monime_phone_verification (
  business_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  last_sent_at TEXT NOT NULL
);
