ALTER TABLE players ADD COLUMN jackpot TEXT;

CREATE TABLE jackpot_pools (
  tier TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO jackpot_pools (tier, amount) VALUES
  ('minor', 25), ('major', 100), ('mega', 500), ('grand', 2500);

CREATE TABLE jackpot_awards (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  tier TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
);

-- A failed optimistic update must abort the entire D1 batch, including its
-- spin log, pool reservation and credit award. changes() is connection-local.
CREATE TABLE mutation_guard (id INTEGER PRIMARY KEY CHECK (id = 1), ok INTEGER NOT NULL CONSTRAINT current_version CHECK (ok = 1));
