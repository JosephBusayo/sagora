-- UC05: what an operator can run, and when they are away. Away dates block scheduling the person
-- the same way an overlapping job does; an empty pair means no time away is recorded.
ALTER TABLE team_member ADD COLUMN skills TEXT NOT NULL DEFAULT '';
ALTER TABLE team_member ADD COLUMN away_from TEXT NOT NULL DEFAULT '';
ALTER TABLE team_member ADD COLUMN away_to TEXT NOT NULL DEFAULT '';
