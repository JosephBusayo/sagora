-- "Dry" joins the land condition answers. A CHECK cannot be changed in place on SQLite, so the
-- column is replaced: a new one with the wider check, the answers copied, the old one dropped.
-- Every statement here means the same on SQLite and Postgres.
ALTER TABLE service_request ADD COLUMN land_condition_next TEXT NOT NULL DEFAULT ''
  CHECK (land_condition_next IN ('', 'sloped', 'wet_swampy', 'dry', 'flat', 'rocky'));
UPDATE service_request SET land_condition_next = land_condition;
ALTER TABLE service_request DROP COLUMN land_condition;
ALTER TABLE service_request RENAME COLUMN land_condition_next TO land_condition;

-- The chiefdom inside the district. Empty for the Western Area, which has none, and for requests
-- made before it was asked.
ALTER TABLE service_request ADD COLUMN chiefdom TEXT NOT NULL DEFAULT '';
