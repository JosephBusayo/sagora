-- Staff are added from inside the company, by an admin. Only the hash of the token is stored.
CREATE TABLE IF NOT EXISTS staff_invite (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('staff','admin')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_invite_open ON staff_invite (email) WHERE used_at IS NULL;
