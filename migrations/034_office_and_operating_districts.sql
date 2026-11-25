-- Where a provider's office is, and where a provider actually works, kept apart (Joseph,
-- 25 Nov 2026).
--
-- Until now there was one district on a business and it did both jobs: it was the address on the
-- application form, and — through `homeAreas` in lib/coverage.ts and the fallback branch in
-- `providersCovering` — it was also what decided which requests reached them. A provider whose
-- office is in Bombali but who works across Tonkolili therefore got Bombali's requests and none of
-- Tonkolili's, which is backwards.
--
-- So: `office_address` is the street or landmark of the office, beside the district and town that
-- were always there. `operating_districts` is the separate, explicit list of where they work, and
-- it is the only one matching may read.
--
-- The backfill copies the office district into the operating list for every business that already
-- has one. That is deliberate and conservative: today's matching already behaves as though the
-- setup district were the operating area, and the providers on the platform chose it under a form
-- that asked "where do you work". Starting them with an empty list would quietly cut every one of
-- them off from requests on the morning this ships. The field is separate and editable from here
-- on, which is the point.

ALTER TABLE provider_business ADD COLUMN office_address TEXT NOT NULL DEFAULT '';

-- A JSON array of district names, the same shape and storage as the `services` column beside it,
-- so the one LIKE-matching idiom already used for services works for these too.
ALTER TABLE provider_business ADD COLUMN operating_districts TEXT NOT NULL DEFAULT '[]';

UPDATE provider_business
   SET operating_districts = '["' || district || '"]'
 WHERE district <> '' AND operating_districts = '[]';
