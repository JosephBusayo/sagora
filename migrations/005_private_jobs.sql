-- A job a provider won outside Sagora. It is held as a request owned by that business, so it goes
-- through the same scheduling and overlap checks, but it is never listed for other providers.
ALTER TABLE service_request ADD COLUMN private_to TEXT;
CREATE INDEX IF NOT EXISTS service_request_private ON service_request (private_to);
