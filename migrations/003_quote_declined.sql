-- A declined quote keeps the status 'not_selected' (the farmer did not choose it). The time says
-- why: a status CHECK cannot be changed the same way on SQLite and Postgres.
ALTER TABLE quote ADD COLUMN declined_at TEXT;
