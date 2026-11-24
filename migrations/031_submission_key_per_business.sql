-- Fixes the index migration 030 added, which was globally unique when it needed to be unique per
-- business.
--
-- Why it mattered. `addAsset` looks a submission key up scoped to the business that sent it:
--
--   SELECT id FROM equipment WHERE submission_key=? AND business_id=?
--
-- With a globally unique index, one business's key could block another business's insert while
-- that scoped lookup found nothing to return — so the insert did nothing, the lookup found
-- nothing, and the function returned null where its signature promises an Asset. A crash, not a
-- refusal, and exactly the kind of thing that only ever happens on somebody else's machine.
--
-- Keys are server-generated UUIDs, so two businesses colliding is vanishingly unlikely in
-- practice; the rule suite hit it immediately because it reuses a fixed key on purpose. An index
-- whose shape disagrees with the query that depends on it is worth correcting whether or not the
-- collision is likely.
--
-- `payment (source, external_ref)` has been keyed this way since migration 001, for the same
-- reason: an idempotency key belongs to whoever issued it.
--
-- Migration 030 is left exactly as it was applied rather than corrected in place. An applied
-- migration is history: editing one makes two databases claim the same version with different
-- contents, which is precisely what the checksum in src/lib/migrate.ts refuses to allow.
DROP INDEX IF EXISTS equipment_submission_key;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_submission_key
  ON equipment (business_id, submission_key)
  WHERE submission_key IS NOT NULL;
