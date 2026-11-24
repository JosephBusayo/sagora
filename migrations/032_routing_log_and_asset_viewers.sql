-- Karim's handover, 23 November 2026, on the two things nobody can currently see:
--
--   "Log every routing decision — eligible, notified or excluded, and why — and make it visible to
--    an administrator."                                                                     (A01)
--   "Support an authorised asset-owner viewer, scoped to named assets only."                (A15)

/* ----------------------------------------------------- why a provider did or did not hear */

-- A01. When a request is created, Sagora decides which approved providers should know about it.
-- That decision was invisible: scripts/why-no-match.mts could reconstruct it from a terminal, but
-- only as the coverage stands *now*, which is no use at all when the question is "why did nobody
-- quote this in November" and the coverage has changed since.
--
-- One row per provider per request, written at the moment the decision is made. It is a record of
-- what was decided and why, not a cache: nothing reads it to make a decision, so it can never
-- disagree with the routing itself.
CREATE TABLE IF NOT EXISTS routing_decision (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  --  notified  - eligible, and told
  --  eligible  - eligible, but not told (no email on file, or a direct request to somebody else)
  --  excluded  - not eligible; `reason` says what failed
  outcome TEXT NOT NULL CHECK (outcome IN ('notified', 'eligible', 'excluded')),
  -- In the words a person would use: "does not cover planting in Bombali", "not approved yet".
  reason TEXT NOT NULL DEFAULT '',
  decided_at TEXT NOT NULL,
  UNIQUE (request_id, business_id)
);
CREATE INDEX IF NOT EXISTS routing_decision_request ON routing_decision (request_id, outcome);
CREATE INDEX IF NOT EXISTS routing_decision_business ON routing_decision (business_id, decided_at);

/* ------------------------------------------- somebody who may see one machine and nothing else */

-- A15. A donor or lessor who put up a tractor is entitled to know how that tractor is being used.
-- They are not entitled to the provider's customers, prices or other equipment, and they have no
-- business having a provider login to get at it.
--
-- So: a grant per machine per person, made by the business that owns the machine. The viewer sees
-- the named assets and their utilisation; every read is scoped by this table and there is no join
-- from it to a request, a quote or a farmer. See src/lib/asset-viewers.ts.
CREATE TABLE IF NOT EXISTS asset_viewer (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  -- The business granting it, kept so a grant can be listed and revoked without joining equipment.
  business_id TEXT NOT NULL,
  -- Who may look. An email rather than a user id: the people this is for — a donor's programme
  -- officer, a lessor's clerk — do not have Sagora accounts and should not need one.
  email TEXT NOT NULL,
  -- What to call them on the screen that lists the grant.
  label TEXT NOT NULL DEFAULT '',
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_by TEXT NOT NULL DEFAULT '',
  revoked_at TEXT NOT NULL DEFAULT '',
  UNIQUE (equipment_id, email)
);
CREATE INDEX IF NOT EXISTS asset_viewer_email ON asset_viewer (email, revoked_at);
CREATE INDEX IF NOT EXISTS asset_viewer_business ON asset_viewer (business_id, revoked_at);
