-- The three land questions on the booking flow. Empty means the request was made before they
-- were asked, or, for condition, that the farmer skipped it: the design marks that one optional.
ALTER TABLE service_request ADD COLUMN land_access TEXT NOT NULL DEFAULT ''
  CHECK (land_access IN ('', 'easy', 'moderate', 'difficult'));
ALTER TABLE service_request ADD COLUMN land_condition TEXT NOT NULL DEFAULT ''
  CHECK (land_condition IN ('', 'sloped', 'wet_swampy', 'flat', 'rocky'));
ALTER TABLE service_request ADD COLUMN land_clearance TEXT NOT NULL DEFAULT ''
  CHECK (land_clearance IN ('', 'vegetation_remains', 'cleared', 'stumps_or_stones'));
