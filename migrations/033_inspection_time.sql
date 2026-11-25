-- Agreeing a farm visit both ways (Joseph, 25 Nov 2026): either side can put a day and time
-- forward, the other accepts it or suggests another, and only an accepted time books the visit.
-- The day columns stay plain dates, so everything that reads scheduled_for keeps working; the time
-- sits beside them. proposed_side says whose suggestion is waiting: 'farmer' or 'provider'.
ALTER TABLE inspection ADD COLUMN proposed_time TEXT NOT NULL DEFAULT '';
ALTER TABLE inspection ADD COLUMN proposed_side TEXT NOT NULL DEFAULT '';
ALTER TABLE inspection ADD COLUMN scheduled_time TEXT NOT NULL DEFAULT '';
UPDATE inspection SET proposed_side = 'farmer' WHERE proposed_for <> '';
