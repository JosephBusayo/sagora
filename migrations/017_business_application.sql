-- UC02: what Sagora needs to review a provider, beyond name and coverage. Empty on businesses that
-- were set up before these were asked; they are required on the next submission only.
ALTER TABLE provider_business ADD COLUMN business_type TEXT NOT NULL DEFAULT ''
  CHECK (business_type IN ('', 'individual', 'cooperative', 'company'));
ALTER TABLE provider_business ADD COLUMN authorised_name TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_business ADD COLUMN authorised_role TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_business ADD COLUMN pricing_basis TEXT NOT NULL DEFAULT ''
  CHECK (pricing_basis IN ('', 'per_acre', 'per_hectare', 'per_day', 'per_job'));
ALTER TABLE provider_business ADD COLUMN included_costs TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_business ADD COLUMN deposit_terms TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_business ADD COLUMN cancellation_terms TEXT NOT NULL DEFAULT '';

-- Identity and registration papers. Private: only the business itself and Sagora staff can open
-- one, through a route that checks who is asking, and every staff opening is written to the audit
-- log. Kept as base64 with the record, like equipment photos: images are shrunk in the browser
-- and files are capped at 3 MB.
CREATE TABLE IF NOT EXISTS business_document (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES provider_business(id),
  kind TEXT NOT NULL CHECK (kind IN ('id', 'registration', 'other')),
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS business_document_business ON business_document (business_id);
