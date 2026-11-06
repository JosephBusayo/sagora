-- What the Add equipment screens ask about a machine. The name a machine is listed under is now
-- its brand and model; older machines keep the name they were given.
-- services: comma-separated service ids. availability: the provider's own say on whether it can
-- be booked (available, unavailable, maintenance), separate from faults.
ALTER TABLE equipment ADD COLUMN brand TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN year TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN horsepower TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN implements TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN services TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment ADD COLUMN availability TEXT NOT NULL DEFAULT 'available';
