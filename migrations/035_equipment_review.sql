-- Equipment waits for Sagora to look at it before it can be put on a farmer's work
-- (Joseph, 25 Nov 2026).
--
-- A provider could register anything: a machine they do not own, a tractor that does not exist, a
-- serial copied off another register. Nothing about a row typed into a form makes it true. So a
-- new machine is saved — it is theirs, it belongs on their register, and they can keep editing it
-- — but it is not usable for a quote or a job until somebody at Sagora has seen it.
--
-- Separate from `status`, which is the machine's own life (active or retired), and from
-- `condition`, which is whether it works. A machine can be approved and broken, or rejected and
-- in perfect order. Three different questions, three columns.
--
-- The default is 'pending' so that any path which inserts a row without thinking about this gets
-- the safe answer. Everything already on the register at this moment is then approved in one
-- statement: those machines have been quoting and working for weeks, and resetting them would
-- stop every provider on the platform mid-season to re-approve what already runs.

ALTER TABLE equipment ADD COLUMN review TEXT NOT NULL DEFAULT 'pending'
  CHECK (review IN ('pending', 'approved', 'rejected'));

-- Why it was rejected, in words the provider reads and can act on.
ALTER TABLE equipment ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN reviewed_at TEXT NOT NULL DEFAULT '';
-- When the provider last put it up for review. Resubmitting a rejected machine sets it again, so
-- the queue can be read oldest-first and nothing waits for ever behind a resubmission.
ALTER TABLE equipment ADD COLUMN submitted_at TEXT NOT NULL DEFAULT '';

UPDATE equipment SET review = 'approved', reviewed_by = 'migration-035', reviewed_at = created_at;

CREATE INDEX IF NOT EXISTS equipment_review ON equipment (review, submitted_at);
