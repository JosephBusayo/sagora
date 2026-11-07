-- UC04/UC03: where a provider works, as district and service pairs. The district and services from
-- setup become the first rows when the business is approved. A pair added later is 'pending'
-- until Sagora reviews it, and only 'active' pairs bring requests. Removing a pair takes effect at once.
CREATE TABLE IF NOT EXISTS provider_coverage (
  business_id TEXT NOT NULL,
  district TEXT NOT NULL,
  service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  PRIMARY KEY (business_id, district, service)
);
CREATE INDEX IF NOT EXISTS provider_coverage_match ON provider_coverage (district, service, status);

-- Businesses approved before this: their one district and their services, as they were.
INSERT INTO provider_coverage (business_id, district, service, status, requested_at, decided_at)
  SELECT id, district, 'ploughing', 'active', updated_at, updated_at FROM provider_business
   WHERE status = 'approved' AND district <> '' AND services LIKE '%"ploughing"%'
  ON CONFLICT DO NOTHING;
INSERT INTO provider_coverage (business_id, district, service, status, requested_at, decided_at)
  SELECT id, district, 'harvesting', 'active', updated_at, updated_at FROM provider_business
   WHERE status = 'approved' AND district <> '' AND services LIKE '%"harvesting"%'
  ON CONFLICT DO NOTHING;
INSERT INTO provider_coverage (business_id, district, service, status, requested_at, decided_at)
  SELECT id, district, 'planting', 'active', updated_at, updated_at FROM provider_business
   WHERE status = 'approved' AND district <> '' AND services LIKE '%"planting"%'
  ON CONFLICT DO NOTHING;
