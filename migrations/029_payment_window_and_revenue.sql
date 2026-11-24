-- Karim's handover, 23 November 2026, on the edges where money meets the reservation:
--
--   "Hold the reservation for a bounded period between acceptance and payment, and show the
--    deadline. Release unused capacity when it lapses."                                  (A07)
--   "Money arriving after the hold has expired, or after capacity has been lost, must go to
--    resolution rather than confirming a booking that cannot happen."                    (A10)
--   "Report revenue earned per machine, net of fees and attributable refunds. Where a job used
--    several machines the allocation must reconcile, and anything not allocated must be shown and
--    excluded rather than quietly spread."                                               (A14)
--
-- Nothing is dropped and no existing figure moves. The identity the ledger has always kept —
-- gross = fee + net — is untouched by everything below; per-machine revenue is a division of the
-- net that already exists, not a second source for it.

/* ------------------------------------------- the window between acceptance and payment */

-- A07. Until now an accepted quote held its machines for ever: the holds converted to the booking
-- and the job owned the dates whether or not the farmer ever paid. That is the single most
-- expensive thing a provider can have happen to them, because the machine is unavailable and
-- nobody is paying for it.
--
-- `pay_by` is the instant the reservation stops standing. Empty means no deadline, which is what
-- every existing agreement gets: backfilling a deadline that has already passed would lapse live
-- bookings on the first sweep, and none of those farmers has done anything wrong.
ALTER TABLE agreement ADD COLUMN pay_by TEXT NOT NULL DEFAULT '';

-- Set when the window closed with nothing paid. The agreement itself survives — what was agreed is
-- a fact, and the farmer may still want the work — but the dates let go.
ALTER TABLE agreement ADD COLUMN lapsed_at TEXT NOT NULL DEFAULT '';
ALTER TABLE agreement ADD COLUMN lapsed_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS agreement_pay_by ON agreement (lapsed_at, pay_by);

/* ------------------------------------------------- which machine earned what */

-- A14. A job with one machine needs no allocation: that machine earned the lot. A job with a
-- tractor and a plough needs a rule, and the handover forbids the comfortable one — anything not
-- allocated must be "shown and excluded rather than quietly spread".
--
-- So: absent a row here, a job's net is divided equally between the machines on it, and the
-- remainder of that integer division is **not allocated**. With a row here, the shares are what
-- the provider said they are, and whatever is left over is likewise not allocated. Either way the
-- per-machine figures plus the unallocated remainder add back to the net exactly.
--
-- Basis points rather than percentages, because a three-machine job does not divide into whole
-- percents and rounding it would be the quiet spreading the handover warns against.
CREATE TABLE IF NOT EXISTS revenue_allocation (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  -- Out of 10,000. The rows for one job may sum to less than 10,000; the rest is unallocated.
  share_bp INTEGER NOT NULL CHECK (share_bp >= 0 AND share_bp <= 10000),
  note TEXT NOT NULL DEFAULT '',
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  UNIQUE (job_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS revenue_allocation_job ON revenue_allocation (job_id);
CREATE INDEX IF NOT EXISTS revenue_allocation_equipment ON revenue_allocation (equipment_id);

-- "Net of fees and attributable refunds." A refund can be about one machine — the plough that
-- broke and left half the field undone — and attributing it to that machine is the difference
-- between a report that explains a loss and one that hides it across the fleet.
--
-- Empty means the refund is about the job rather than any one machine, and it is divided by the
-- same allocation as the earnings.
ALTER TABLE release ADD COLUMN equipment_id TEXT NOT NULL DEFAULT '';
