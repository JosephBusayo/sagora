-- Voice-note request intake. Logs what Gemini heard and extracted, for debugging bad
-- transcriptions and knowing which requests started as a voice note. Raw audio is never stored
-- here — only the transcript and the extracted fields survive the single call to Gemini.
CREATE TABLE IF NOT EXISTS voice_intake (
  id TEXT PRIMARY KEY,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('farmer', 'guest', 'staff', 'provider')),
  created_by_id TEXT,
  transcript TEXT NOT NULL DEFAULT '',
  extracted_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('transcribed', 'failed')),
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS voice_intake_created ON voice_intake (created_at);
