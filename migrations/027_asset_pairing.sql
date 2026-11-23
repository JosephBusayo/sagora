-- "Record Compatible, Needs checking or Not compatible, with reviewer, date and supporting
-- machine/implement information. Unknown critical details block the affected service."
--   — Karim's handover, 23 November 2026
--
-- The catalogue in src/lib/catalogue.ts says a plough goes behind a tractor. It cannot say whether
-- THIS plough goes behind THIS tractor: that depends on hitch category, lift capacity and the
-- power it needs, and the handover is explicit that a type match is not an engineering approval
-- ("developers must verify the actual model pairing rather than treating a generic type as an
-- engineering approval"). So a pairing is a judgement a person records, with their name on it.
--
-- One row per machine, implement and service, because the same two machines can be right for
-- ploughing and wrong for ridging.
CREATE TABLE IF NOT EXISTS asset_pairing (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  implement_id TEXT NOT NULL,
  service TEXT NOT NULL,
  -- 'checking' is the honest default for a pair nobody has looked at: not a refusal, not an
  -- approval, and it blocks the service until somebody decides.
  verdict TEXT NOT NULL DEFAULT 'checking' CHECK (verdict IN ('compatible', 'checking', 'incompatible')),
  -- What the verdict rests on: measured hitch, the manual, a dealer's word.
  basis TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (machine_id, implement_id, service)
);
CREATE INDEX IF NOT EXISTS asset_pairing_machine ON asset_pairing (machine_id, service);
CREATE INDEX IF NOT EXISTS asset_pairing_business ON asset_pairing (business_id, verdict);
