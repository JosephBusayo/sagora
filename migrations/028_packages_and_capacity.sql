-- Karim's handover, 23 November 2026, on capacity that tells the truth:
--
--   "For a package such as ploughing and harrowing, plan each operation and reserve its resources
--    for its own window. All stages must be covered before the package is quoted."
--   "Account for travel and set-up time so the days either side of the work are not offered as free."
--   "Require confirmation of machine condition and outside commitments at quotation, and recheck
--    before dispatch. Capacity that has gone stale stays blocked until it is confirmed again."
--   "A new blocking fault must flag existing bookings for action rather than cancelling them
--    silently."
--   "A shared asset shares its reservation constraint without sharing business data."
--
-- Five rules, one migration, because they all turn on the same thing: what a reservation covers.
-- Until now a hold covered one service over one window. From here it covers one *operation* of a
-- request over one window, padded by the travel it takes to get there and back.
--
-- Nothing is dropped and nothing is rebuilt. service_request.service stays exactly where it is and
-- keeps its meaning — it is the first operation of the request — so the hundred-odd places that
-- read it carry on reading it. The ordered list below is additive.

/* ------------------------------------------------------ a request is a list of operations */

-- One row per stage the farmer asked for, in agronomic order: you cannot harrow before you plough.
-- A single-service request is a list of one, which is why this needed no fork in the code: every
-- request has operations, and most have exactly one.
--
-- `acres` is nullable and almost always null: a package is normally the same field worked three
-- times, so the request's own acreage stands for every stage. It exists for the case where one
-- stage covers less ground than the rest.
CREATE TABLE IF NOT EXISTS request_operation (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  service TEXT NOT NULL,
  -- 1-based, and the order the work must happen in rather than the order it was ticked.
  sequence INTEGER NOT NULL,
  acres REAL,
  created_at TEXT NOT NULL,
  -- The same service twice in one request is a mistake, not a package.
  UNIQUE (request_id, service)
);
CREATE INDEX IF NOT EXISTS request_operation_request ON request_operation (request_id, sequence);
CREATE INDEX IF NOT EXISTS request_operation_service ON request_operation (service);

-- Every request that already exists becomes a list of one, so routing, quoting and the provider's
-- screens can read operations from today without a single null check.
INSERT INTO request_operation (id, request_id, service, sequence, acres, created_at)
SELECT 'op-' || r.id, r.id, r.service, 1, NULL, r.created_at
  FROM service_request r
 WHERE NOT EXISTS (SELECT 1 FROM request_operation o WHERE o.request_id = r.id);

/* ------------------------------------------------ a quote plans each stage separately */

-- "Plan each operation and reserve its resources for its own window." The provider gives one
-- preferred start and sequences the stages themselves, because the gap between ploughing and
-- harrowing depends on the soil and the rain — that is their judgement, not the farmer's.
--
-- Each row carries its own price, so the farmer sees that harrowing is one day and ploughing three
-- rather than one opaque total. The quote's amount_minor stays the sum, which is what the agreement
-- freezes and what the ledger has always posted.
CREATE TABLE IF NOT EXISTS quote_operation (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  service TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  days_to_complete INTEGER NOT NULL DEFAULT 1,
  daily_rate_minor INTEGER NOT NULL DEFAULT 0,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (quote_id, operation_id)
);
CREATE INDEX IF NOT EXISTS quote_operation_quote ON quote_operation (quote_id, sequence);

-- Existing quotes become a plan of one stage, priced at what they already said.
INSERT INTO quote_operation (id, quote_id, operation_id, service, sequence, start_date,
       days_to_complete, daily_rate_minor, amount_minor, created_at)
SELECT 'qop-' || q.id, q.id, o.id, o.service, 1, q.start_date,
       COALESCE(q.days_to_complete, 1), COALESCE(q.daily_rate_minor, 0), q.amount_minor, q.created_at
  FROM quote q
  JOIN request_operation o ON o.request_id = q.request_id AND o.sequence = 1
 WHERE NOT EXISTS (SELECT 1 FROM quote_operation x WHERE x.quote_id = q.id);

/* ----------------------------------------------- travel and set-up either side of the work */

-- "The days either side of the work are not offered as free." A hold now carries two windows: the
-- days the work happens, and the wider span the machine is actually unavailable for.
--
-- Storing the padded span rather than computing it keeps old reservations honest. If the travel
-- allowance changes next month, a hold placed today still blocks exactly the days it was placed
-- against, and a provider can see why.
ALTER TABLE resource_hold ADD COLUMN block_from TEXT NOT NULL DEFAULT '';
ALTER TABLE resource_hold ADD COLUMN block_to TEXT NOT NULL DEFAULT '';
-- Which stage of the request this hold belongs to. Empty on every row written before packages,
-- which is correct: those requests have one operation and the hold covers all of it.
ALTER TABLE resource_hold ADD COLUMN operation_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS resource_hold_block ON resource_hold (resource_id, status, block_from, block_to);

-- Existing holds blocked exactly their working days, and saying otherwise after the fact would
-- invent a conflict that nobody caused.
UPDATE resource_hold SET block_from = start_date, block_to = end_date WHERE block_from = '';

ALTER TABLE job ADD COLUMN block_from TEXT;
ALTER TABLE job ADD COLUMN block_to TEXT;
UPDATE job SET block_from = start_date, block_to = end_date WHERE block_from IS NULL;

/* --------------------------------------------------- capacity that has to be confirmed */

-- "Require confirmation of machine condition and outside commitments at quotation, and recheck
-- before dispatch." The confirmation is a statement by a named person at a known moment, so it can
-- go stale — and a stale one blocks rather than passes.
ALTER TABLE quote ADD COLUMN capacity_confirmed_at TEXT NOT NULL DEFAULT '';
ALTER TABLE quote ADD COLUMN capacity_confirmed_by TEXT NOT NULL DEFAULT '';
-- What the provider declared they have on outside this platform: private work, another contract,
-- a machine lent to a neighbour. Sagora cannot see any of it, so it has to ask.
ALTER TABLE quote ADD COLUMN outside_commitments TEXT NOT NULL DEFAULT '';

-- Quotes sent before this rule existed were confirmed by the act of sending them, under the rule
-- that applied at the time. Backdating a blocking condition onto live quotes would expire work
-- that nobody has done anything wrong on.
UPDATE quote SET capacity_confirmed_at = created_at, capacity_confirmed_by = created_by
 WHERE capacity_confirmed_at = '';

ALTER TABLE job ADD COLUMN dispatch_checked_at TEXT NOT NULL DEFAULT '';
ALTER TABLE job ADD COLUMN dispatch_checked_by TEXT NOT NULL DEFAULT '';

/* ----------------------------------------------- a fault flags work, it does not cancel it */

-- "A new blocking fault must flag existing bookings for action rather than cancelling them
-- silently." A broken tractor is not the farmer's fault and may well be fixed by Tuesday, so the
-- booking stays and somebody is told to deal with it.
--
-- Resolved, never deleted: how a provider answered a flag is part of the job's history and part of
-- what a dispute would turn on.
CREATE TABLE IF NOT EXISTS booking_flag (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  -- 'fault' today; the column exists because a lapsed lease and a withdrawn share flag the same way.
  cause TEXT NOT NULL DEFAULT 'fault' CHECK (cause IN ('fault', 'lease', 'share', 'condition')),
  reason TEXT NOT NULL,
  raised_by TEXT NOT NULL DEFAULT '',
  raised_at TEXT NOT NULL,
  resolved_by TEXT NOT NULL DEFAULT '',
  resolved_at TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL DEFAULT '',
  UNIQUE (job_id, equipment_id, cause, raised_at)
);
CREATE INDEX IF NOT EXISTS booking_flag_open ON booking_flag (job_id, resolved_at);
CREATE INDEX IF NOT EXISTS booking_flag_business ON booking_flag (equipment_id, resolved_at);

/* ------------------------------------------- one machine, two providers, no shared customers */

-- "A shared asset shares its reservation constraint without sharing business data."
--
-- The constraint half is free: a hold is on a resource id, so a machine two businesses can both
-- commit already collides with itself whatever letterhead the quote came on. What this table adds
-- is permission — whose register a borrowed machine appears on — and what it does NOT add is any
-- route from one business to the other's requests, prices or farmers.
--
-- The privacy edge is in the clash message rather than here: a borrower who finds the machine busy
-- is told the dates and nothing else. See `redactFor` in src/lib/holds.ts.
CREATE TABLE IF NOT EXISTS asset_share (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  -- The business allowed to commit it. The owner is equipment.business_id and is never listed here.
  business_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_by TEXT NOT NULL DEFAULT '',
  revoked_at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (equipment_id, business_id)
);
CREATE INDEX IF NOT EXISTS asset_share_business ON asset_share (business_id, revoked_at);
CREATE INDEX IF NOT EXISTS asset_share_equipment ON asset_share (equipment_id, revoked_at);
