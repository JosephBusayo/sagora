-- One key per request form, made when the form is drawn and sent with it. A form sent twice (a
-- double tap, or a retry after the connection dropped) carries the same key, and the second send
-- finds the first request instead of making another.
ALTER TABLE service_request ADD COLUMN submission_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS service_request_submission_key ON service_request (submission_key) WHERE submission_key IS NOT NULL;
