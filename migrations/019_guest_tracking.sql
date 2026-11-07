-- A request sent without an account. The farmer is given a tracking code (SAG-8KM32) and comes back
-- with it and their phone number. Only a keyed hash of the code is stored, so the codes cannot be
-- read from the database. A new code replaces the old one, which also signs out any browser that
-- was using the old one.
ALTER TABLE service_request ADD COLUMN tracking_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS service_request_tracking_hash ON service_request (tracking_hash) WHERE tracking_hash IS NOT NULL;

-- Wrong tries at "Find your request", counted per phone number and per address, so a code cannot
-- be guessed by trying them all.
CREATE TABLE IF NOT EXISTS guest_lookup_miss (
  id TEXT PRIMARY KEY,
  phone_key TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_lookup_miss_phone ON guest_lookup_miss (phone_key, created_at);
CREATE INDEX IF NOT EXISTS guest_lookup_miss_ip ON guest_lookup_miss (ip, created_at);
