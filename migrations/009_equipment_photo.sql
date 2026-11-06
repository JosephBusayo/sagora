-- One photo per piece of equipment, as the Add equipment design asks for. The browser shrinks it
-- to a small JPEG before upload, so it is kept here as base64 rather than in a separate file store.
CREATE TABLE IF NOT EXISTS equipment_photo (
  equipment_id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
