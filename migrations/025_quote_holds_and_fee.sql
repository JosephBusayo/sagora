-- Karim's handover of 23 November 2026, which is the source of truth where it differs from the
-- 22 November call. Five of its reversals land here.
--
-- 1. CAPACITY IS HELD WHEN THE QUOTE IS SENT, NOT WHEN IT IS ACCEPTED.
--    The call said a machine stays free while a quote is open. The handover says the opposite:
--    "Send quotation — validate and hold the complete resource set." So a hold is now a record in
--    its own right, made at send time, released on decline/withdrawal/expiry, and converted into
--    the job's commitment when payment confirms. It covers operators as well as machines, because
--    "the same rule applies to machines and operators".
--
--    Holds live in their own table rather than as rows on the job: a job exists only after a
--    quote is accepted, and these have to exist before that — several at once, on one request,
--    from competing providers.
CREATE TABLE IF NOT EXISTS resource_hold (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  -- Machines and operators are held the same way and clash the same way.
  kind TEXT NOT NULL CHECK (kind IN ('equipment', 'operator')),
  resource_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'converted')),
  -- Copied from the quote so expiry can be swept without reading the quote back.
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  released_at TEXT,
  release_reason TEXT NOT NULL DEFAULT ''
);
-- The clash query reads by resource and window, so that is what is indexed.
CREATE INDEX IF NOT EXISTS resource_hold_resource ON resource_hold (kind, resource_id, status);
CREATE INDEX IF NOT EXISTS resource_hold_quote ON resource_hold (quote_id);
CREATE INDEX IF NOT EXISTS resource_hold_expiry ON resource_hold (status, expires_at);

-- 2. PRICING IS BY MACHINE-DAY: numeric days, a daily rate and a service total.
--    days_to_complete arrived yesterday; the rate did not. amount_minor stays the service total,
--    so nothing that already reads it changes meaning. A zero rate means a quote sent before this
--    existed, or one priced as a lump sum.
ALTER TABLE quote ADD COLUMN daily_rate_minor INTEGER NOT NULL DEFAULT 0;

-- 3. A QUOTE NAMES AN ACTUAL OPERATOR, not an operator role.
--    "Select actual asset IDs and an actual operator." The machines are already in quote_asset.
ALTER TABLE quote ADD COLUMN operator_id TEXT;

-- 4. EXPIRY IS AN EXACT MOMENT, CAPPED AT THE PROPOSED START.
--    "The discussed starting hold is 48 hours, with the exact expiry shown. Never let it run past
--    the proposed start." A computed 48 hours could outlive the work it was quoting for, so the
--    moment is written down once, at send time, and shown to the farmer. Empty on older rows,
--    which fall back to 48 hours from created_at.
--    Sierra Leone keeps UTC+0 all year, so a stored UTC instant is already Sierra Leone time.
ALTER TABLE quote ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';

-- 5. SAGORA'S 10% IS ADDED TO THE FARMER'S TOTAL, NOT DEDUCTED FROM THE PROVIDER.
--    "Add 10% to the provider price; do not deduct it from the provider or calculate 2,020."
--    Provider 2,000 + fee 200 = farmer 2,200, and the provider's 2,000 is untouched.
--
--    The agreement is the frozen record of what was agreed, so the fee is frozen with it: a later
--    change to the fee policy must never alter what an existing farmer owes. amount_minor keeps
--    meaning the provider's service price; the farmer's obligation is amount_minor + fee_minor.
ALTER TABLE agreement ADD COLUMN fee_minor INTEGER NOT NULL DEFAULT 0;
