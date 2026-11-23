-- Karim's handover, 23 November 2026: "Sagora must maintain a current record of who controls each
-- physical asset and when it can be used." Everything else in the equipment half of that document
-- rests on an asset being one durable, identifiable thing, so this is the foundation for it.
--
-- Nothing here is dropped. The columns this supersedes (status, availability) keep their values and
-- their CHECK constraints, because SQLite cannot alter a CHECK and rebuilding a table that job_asset
-- and quote_asset point at is not worth the risk. `condition` below is the authoritative field from
-- now on; the old two are backfilled into it once and then left alone.

/* ------------------------------------------------- identity that survives a rename */

-- "Permanent asset ID, provider reference... Renaming or transferring custody must not create a new
-- machine." The primary key was already permanent; what was missing is the reference a provider
-- actually says out loud, which is theirs to choose and need not be unique across businesses.
ALTER TABLE equipment ADD COLUMN asset_ref TEXT NOT NULL DEFAULT '';

-- "Missing or unreadable machine serials permit draft saving and review only. Quotation remains
-- blocked unless Karim approves an exception policy and the asset satisfies it."
--   recorded   - the serial in `identifier` is real and readable
--   unreadable - there is a plate but it cannot be read; needs review
--   none       - a simple unnumbered implement that never had one
-- Only 'recorded', or an exception an administrator has granted, lets the asset be quoted.
ALTER TABLE equipment ADD COLUMN serial_status TEXT NOT NULL DEFAULT 'recorded'
  CHECK (serial_status IN ('recorded', 'unreadable', 'none'));
ALTER TABLE equipment ADD COLUMN serial_exception_by TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN serial_exception_note TEXT NOT NULL DEFAULT '';

/* ----------------------------------------------------------------- condition */

-- The four states the handover names, replacing the old split between status (active/retired) and
-- availability (available/unavailable/maintenance).
--   working  - fit for work
--   limited  - usable, but not for everything; the note says what
--   repair   - under repair, not available
--   retired  - gone from the fleet, kept for history
ALTER TABLE equipment ADD COLUMN condition TEXT NOT NULL DEFAULT 'working'
  CHECK (condition IN ('working', 'limited', 'repair', 'retired'));
ALTER TABLE equipment ADD COLUMN condition_note TEXT NOT NULL DEFAULT '';

-- Backfill, erring towards blocking. An asset previously marked 'unavailable' becomes 'repair'
-- rather than 'limited': both of the old states stopped it being used, and quietly turning a
-- blocked machine into a quotable one would be the worst possible migration bug.
UPDATE equipment SET condition = 'retired' WHERE status = 'retired';
UPDATE equipment SET condition = 'repair' WHERE status <> 'retired' AND availability IN ('maintenance', 'unavailable');
UPDATE equipment SET condition = 'working' WHERE status <> 'retired' AND availability = 'available';

/* -------------------------------------------------------- where it is, and whose */

-- "Last confirmed physical location, timestamp and updater. Coverage districts are separate." The
-- timestamp is the point: Sagora cannot know a machine has moved, so it records when somebody last
-- said where it was, and the screens can show how stale that is.
ALTER TABLE equipment ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN custodian TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN location_at TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN location_by TEXT NOT NULL DEFAULT '';

-- "Owned or Leased; legal owner or lessor where different; managing provider; authorised person who
-- can commit it; lease dates and restrictions." Ownership itself is already on the table.
ALTER TABLE equipment ADD COLUMN lessor TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN lease_from TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN lease_to TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN lease_notes TEXT NOT NULL DEFAULT '';
-- Who inside the business may commit this machine to work, where that is not everybody.
ALTER TABLE equipment ADD COLUMN authorised_by TEXT NOT NULL DEFAULT '';

/* ------------------------------------------------------- type-specific detail */

-- "Power requirement and its basis, hitch/mounting, PTO speed and connection, hydraulics, working
-- width, weight and lifting/towing limits where relevant... not every implement needs PTO."
--
-- A JSON object keyed by spec id rather than a column each, because which specs matter depends on
-- the kind: a subsoiler has a working depth, a sprayer has a tank and nozzles, a drum seeder has
-- neither and no PTO at all. src/lib/specs.ts owns which keys apply to which kind.
ALTER TABLE equipment ADD COLUMN specs TEXT NOT NULL DEFAULT '{}';

/* --------------------------------------------------- optional purchase records */

-- From the FFSL registers: "put optional acquisition date, supplier, purchase cost/currency,
-- receipt, donor/project and use restrictions under Additional details. Do not move purchase costs
-- or depreciation into job earnings." Kept deliberately apart from anything the earnings code reads.
ALTER TABLE equipment ADD COLUMN acquired_on TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN purchase_cost_minor INTEGER;
ALTER TABLE equipment ADD COLUMN purchase_currency TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN donor TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN use_restrictions TEXT NOT NULL DEFAULT '';

/* -------------------------------------------------------------- custody history */

-- Every time a machine changes hands or moves, kept rather than overwritten, so "renaming or
-- transferring custody must not create a new machine" has something to point at afterwards.
CREATE TABLE IF NOT EXISTS asset_custody (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('custody', 'location', 'condition', 'rename')),
  previous TEXT NOT NULL DEFAULT '',
  current TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS asset_custody_equipment ON asset_custody (equipment_id, recorded_at);

/* ------------------------------------------------- two providers, one machine */

-- "Resolve duplicate physical-asset claims through review, using serials and supporting records."
-- Raised automatically when a serial already on the register is entered by somebody else, and left
-- for staff. It flags rather than blocks: the second provider may well be the rightful one, and
-- locking both out would punish whoever registered honestly.
CREATE TABLE IF NOT EXISTS asset_conflict (
  id TEXT PRIMARY KEY,
  serial TEXT NOT NULL,
  equipment_a TEXT NOT NULL,
  equipment_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  resolved_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (equipment_a, equipment_b)
);
CREATE INDEX IF NOT EXISTS asset_conflict_open ON asset_conflict (status, created_at);
