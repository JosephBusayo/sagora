-- UC12: readiness, travel to the farm and the actual start are separate facts, each with who
-- recorded it and when. Planned dates stay in start_date/end_date; these say what really happened.
-- ready_checks holds the ticked checklist items, comma-separated, in the order they are listed in
-- src/lib/jobs.ts.
ALTER TABLE job ADD COLUMN ready_checks TEXT NOT NULL DEFAULT '';
ALTER TABLE job ADD COLUMN ready_at TEXT;
ALTER TABLE job ADD COLUMN mobilised_at TEXT;
ALTER TABLE job ADD COLUMN mobilised_by TEXT;
ALTER TABLE job ADD COLUMN started_at TEXT;
ALTER TABLE job ADD COLUMN started_by TEXT;
