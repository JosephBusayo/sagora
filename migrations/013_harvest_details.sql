-- UC06: what a provider needs to price harvesting, and whether the land is upland or lowland.
-- Empty means not asked (older requests, or a service that does not ask it). 'not_sure' is an
-- answer the farmer gave, and is flagged to the provider as a detail to follow up.
ALTER TABLE service_request ADD COLUMN land_type TEXT NOT NULL DEFAULT ''
  CHECK (land_type IN ('', 'upland', 'lowland', 'not_sure'));
ALTER TABLE service_request ADD COLUMN crop_variety TEXT NOT NULL DEFAULT '';
ALTER TABLE service_request ADD COLUMN planted_on TEXT NOT NULL DEFAULT '';
ALTER TABLE service_request ADD COLUMN crop_readiness TEXT NOT NULL DEFAULT ''
  CHECK (crop_readiness IN ('', 'ready_now', 'ready_soon', 'not_ready', 'not_sure'));
