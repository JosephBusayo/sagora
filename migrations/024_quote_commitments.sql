-- Review with Karim (22 Nov 2026). Three changes to what a quote carries, and one to inspections.
--
-- A quote now names the machines and says how many days the work takes. Those two together give
-- every quote a date range, which is what makes the lock Karim asked for possible: naming a
-- machine on an open quote commits nothing, because a provider quotes widely and wins some. The
-- commitment happens when the farmer accepts, and from then on job_asset and clashesFor() in
-- src/lib/jobs.ts hold the machine for those dates exactly as they always have. Two accepted jobs
-- cannot overlap on one machine; two open quotes on one machine are ordinary business.
--
-- days_to_complete defaults to 1 so quotes sent before today keep a usable range (start, start)
-- rather than a null that every reader would have to special-case.
ALTER TABLE quote ADD COLUMN days_to_complete INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS quote_asset (
  quote_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  PRIMARY KEY (quote_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS quote_asset_equipment ON quote_asset (equipment_id);

-- The farmer now answers an inspection rather than only being told about one: they propose a
-- time, the provider confirms it, and confirming is what sets status='scheduled' and
-- scheduled_for. A proposal is kept separate from the confirmed date so nothing the farmer types
-- can look like an agreed booking until the provider has actually said yes.
ALTER TABLE inspection ADD COLUMN proposed_for TEXT NOT NULL DEFAULT '';
ALTER TABLE inspection ADD COLUMN proposed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE inspection ADD COLUMN proposed_at TEXT NOT NULL DEFAULT '';
