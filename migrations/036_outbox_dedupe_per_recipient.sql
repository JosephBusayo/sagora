-- One event, one email per person — not one email in total (Joseph, 25 Nov 2026).
--
-- The outbox has carried a dedupe key since migration 001, and the index on it was unique across
-- the whole table. That is the wrong shape by one dimension. A single event usually has to reach
-- two people: a dispute resolution goes to the farmer and to the provider, a booking confirmation
-- to both sides. Those two messages are the same event, so the natural key is the same for both —
-- and under a globally unique index the second one is silently dropped and somebody never hears.
--
-- The code has been working around it by writing the role into the key ("booking.confirmed:farmer:…"),
-- which works but is a trap: the next person to add a notification keys it on the event, as you
-- would, and loses half the recipients with no error anywhere.
--
-- Keyed on (recipient, dedupe_key) the natural key is the correct one. Nothing already written
-- changes meaning: every existing key is used for exactly one recipient, so no pair collides and
-- the index builds over the current rows unchanged.

DROP INDEX IF EXISTS outbox_dedupe;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe ON notification_outbox (recipient, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
