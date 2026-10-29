-- 001_init.sql — the whole schema as it stands today.
--
-- Until now every table was created by whichever TypeScript module happened to own it, at import
-- time. That made the schema depend on which module a request loaded first, which is a bug we
-- actually hit: a farmer's home screen failed on a brand-new database because it read the
-- `agreement` table from a module that never loaded the one that created it.
--
-- From here the schema has one home. Every change is a new numbered file; this one is never
-- edited again. The runner records what it has applied and refuses to run a file twice.
--
-- Written so both engines accept it: SQLite today, PostgreSQL when we move. That rules out
-- SQLite's AUTOINCREMENT and Postgres's SERIAL, so `audit_log` takes an id from the application
-- like every other table.
--
-- Deliberately no foreign keys: adding them now would change behaviour, and a migration that
-- also changes behaviour is a migration nobody can review. They belong in their own file.

/* ----------------------------------------------------------------- business */

CREATE TABLE IF NOT EXISTS provider_business (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  town TEXT NOT NULL DEFAULT '',
  services TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','changes_requested','approved','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_member (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','active','removed')),
  invite_hash TEXT,
  invite_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- A removed teammate may be invited back, so uniqueness only covers the live rows.
CREATE UNIQUE INDEX IF NOT EXISTS team_member_business_email
  ON team_member (business_id, email) WHERE status <> 'removed';
CREATE INDEX IF NOT EXISTS team_member_invite ON team_member (invite_hash);

/* --------------------------------------------------------------- equipment */

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL DEFAULT '',
  ownership TEXT NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned','leased')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  notes TEXT NOT NULL DEFAULT '',
  retired_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS equipment_business ON equipment (business_id, status, kind);

CREATE TABLE IF NOT EXISTS equipment_fault (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('blocking','minor')),
  description TEXT NOT NULL,
  reported_by TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution TEXT NOT NULL DEFAULT ''
);
-- Faults are resolved, never deleted, so a machine's history survives.
CREATE INDEX IF NOT EXISTS fault_equipment ON equipment_fault (equipment_id, resolved_at);

/* ---------------------------------------------------- requests and quotes */

CREATE TABLE IF NOT EXISTS service_request (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  farmer_id TEXT,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL,
  acres REAL NOT NULL,
  preferred_date TEXT NOT NULL,
  alternate_date TEXT,
  district TEXT NOT NULL,
  village TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'awaiting_quotes'
    CHECK (status IN ('awaiting_quotes','quotes_sent','in_progress','completed','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS service_request_farmer ON service_request (farmer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_request_browse ON service_request (status, district, service, preferred_date);

-- Hands out SG-1048 and the like, one number at a time inside the request's own transaction.
CREATE TABLE IF NOT EXISTS reference_counter (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quote (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  includes TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','superseded','withdrawn','accepted','not_selected')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- A quote is superseded by a new version, never edited: the pair is unique per provider.
CREATE UNIQUE INDEX IF NOT EXISTS quote_version ON quote (request_id, business_id, version);
CREATE INDEX IF NOT EXISTS quote_request ON quote (request_id, status);
CREATE INDEX IF NOT EXISTS quote_business ON quote (business_id, created_at DESC);

-- The frozen copy of the exact version the farmer accepted. One per request, forever.
CREATE TABLE IF NOT EXISTS agreement (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  quote_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  includes TEXT NOT NULL,
  start_date TEXT NOT NULL,
  accepted_by TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

/* -------------------------------------------------------------------- work */

CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unscheduled'
    CHECK (status IN ('unscheduled','scheduled','in_progress','work_reported','completed','disputed','cancelled')),
  start_date TEXT,
  end_date TEXT,
  operator_id TEXT,
  work_note TEXT NOT NULL DEFAULT '',
  reported_acres REAL,
  reported_at TEXT,
  confirmed_at TEXT,
  concern TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_business ON job (business_id, status);

-- Which machines a job holds. The clash check reads this inside the scheduling transaction.
CREATE TABLE IF NOT EXISTS job_asset (
  job_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  PRIMARY KEY (job_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS job_asset_equipment ON job_asset (equipment_id);

/* ------------------------------------------------------------------ money */

-- Double entry. Every transaction's rows sum to zero; corrections are reversals, never edits.
CREATE TABLE IF NOT EXISTS ledger_entry (
  id TEXT PRIMARY KEY,
  txn_id TEXT NOT NULL,
  account TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  reverses_txn TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entry (account);
CREATE INDEX IF NOT EXISTS ledger_txn ON ledger_entry (txn_id);
CREATE INDEX IF NOT EXISTS ledger_ref ON ledger_entry (ref_type, ref_id);

CREATE TABLE IF NOT EXISTS payment (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  psp_verified INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
-- The receipt reference is the idempotency key: the same payment cannot be recorded twice.
CREATE UNIQUE INDEX IF NOT EXISTS payment_external_ref ON payment (source, external_ref);
CREATE INDEX IF NOT EXISTS payment_request ON payment (request_id);

CREATE TABLE IF NOT EXISTS booking (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL
);

-- Money that arrived when the booking could not be confirmed, and anything else stuck.
CREATE TABLE IF NOT EXISTS exception_case (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS case_open ON exception_case (status, opened_at);

-- Money going out. Prepared by one person, approved by a different one.
CREATE TABLE IF NOT EXISTS release (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('payout','refund')),
  request_id TEXT NOT NULL,
  beneficiary TEXT NOT NULL,
  beneficiary_label TEXT NOT NULL,
  gross_minor INTEGER NOT NULL CHECK (gross_minor > 0),
  fee_minor INTEGER NOT NULL DEFAULT 0,
  net_minor INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','approved','paid','void')),
  method TEXT NOT NULL DEFAULT '',
  external_ref TEXT NOT NULL DEFAULT '',
  prepared_by TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  paid_at TEXT,
  owed_txn TEXT,
  paid_txn TEXT
);
-- One live release of a kind per request: a second payout cannot be prepared alongside the first.
CREATE UNIQUE INDEX IF NOT EXISTS release_live
  ON release (kind, request_id) WHERE status IN ('prepared','approved','paid');
CREATE INDEX IF NOT EXISTS release_queue ON release (status, prepared_at);

CREATE TABLE IF NOT EXISTS payout_destination (
  business_id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_ref TEXT NOT NULL,
  bank TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

/* --------------------------------------------- notifications and security */

-- Saved before it is sent, so nothing is lost when email fails.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe ON notification_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbox_due ON notification_outbox (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS notification_read (
  user_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, notification_id)
);
CREATE INDEX IF NOT EXISTS notification_read_user ON notification_read (user_id);

-- The staff second factor, tied to one session.
CREATE TABLE IF NOT EXISTS staff_mfa (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  code_expires_at TEXT,
  last_sent_at TEXT,
  verified_until TEXT
);
CREATE INDEX IF NOT EXISTS staff_mfa_user ON staff_mfa (user_id);

-- Who did what. The id comes from the application so this works on both engines.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (entity, entity_id, at DESC);
