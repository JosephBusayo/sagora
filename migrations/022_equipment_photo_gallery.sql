-- WAITING-ON (7 Nov): "Several equipment photos" — the design says "photos", plural, and
-- equipment_photo (migration 009) holds exactly one. That table is untouched: it stays the cover
-- photo shown on cards and lists. This adds a gallery of further photos alongside it, so nothing
-- that already reads equipment_photo changes behaviour.
CREATE TABLE IF NOT EXISTS equipment_photos (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS equipment_photos_equipment ON equipment_photos (equipment_id, position);
