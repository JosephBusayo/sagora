-- Karim's handover, 23 November 2026, on the Equipment screens:
--
--   "Move Record downtime and Record private work inside Equipment. Private work recorded outside
--    the booking flow is a second source of scheduling truth."
--   "Drafts and uploads must survive a dropped connection, and a retry must not create a duplicate."
--
-- The first of those is the reason for the table below. Private work already lives in the booking
-- flow as a job with a private customer, so it needed moving rather than building — but downtime
-- had nowhere to go at all. A machine in for servicing was either marked 'repair', which blocks it
-- for ever with no end date, or quietly left available and double-booked.

/* --------------------------------------------------------------- planned downtime */

-- A period a machine is deliberately out of action, with an end date. That last part is the whole
-- point: `condition = 'repair'` says "not available, ask me later", and this says "not available
-- until the 14th", which is what lets the capacity check answer a question about the 15th.
--
-- It blocks the same way a hold does — see `clashesFor` in src/lib/holds.ts, which reads this
-- alongide live holds and committed jobs, so one machine has one availability answer however the
-- question is asked.
CREATE TABLE IF NOT EXISTS asset_downtime (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  -- Denormalised so the capacity check can scope by business without joining equipment.
  business_id TEXT NOT NULL,
  --  service   - planned servicing, an oil change, a safety check
  --  repair    - fixing something known to be wrong
  --  transport - being moved, or lent out and travelling
  --  other     - whatever the provider says it is
  kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service', 'repair', 'transport', 'other')),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  -- Cancelled rather than deleted: a machine's availability history is what a dispute turns on.
  cancelled_at TEXT NOT NULL DEFAULT '',
  cancelled_by TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS asset_downtime_equipment ON asset_downtime (equipment_id, cancelled_at, from_date);
CREATE INDEX IF NOT EXISTS asset_downtime_business ON asset_downtime (business_id, cancelled_at);

/* ------------------------------------------------- a retry is not a second machine */

-- "A retry must not create a duplicate." The request form has solved this since migration 011 with
-- a server-made submission key, and the equipment form had nothing: a farmer on a bad connection
-- who pressed Add twice got one request, and a provider who did the same got two tractors.
--
-- Same mechanism, same shape. Nullable and unique, so rows written before this carry no key and
-- do not collide with each other.
ALTER TABLE equipment ADD COLUMN submission_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_submission_key ON equipment (submission_key)
  WHERE submission_key IS NOT NULL;
