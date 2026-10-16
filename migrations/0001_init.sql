-- Players start as guests. Signing in with Atlesque Play links the player to that account (play_user_id),
-- and the same account on another device finds the same player.
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  play_user_id TEXT UNIQUE,
  play_email TEXT,
  credits REAL NOT NULL,
  bet INTEGER NOT NULL,
  ante INTEGER NOT NULL DEFAULT 0,
  stats TEXT NOT NULL,          -- JSON: { spins, wagered, won, biggestWin, biggestX, features, topUps }
  feature TEXT,                 -- JSON while free spins are in progress: { left, played, totalMult, won, bet }
  last_top_up INTEGER NOT NULL DEFAULT 0,
  play_rev INTEGER,             -- the Atlesque Play progress revision this row last agreed with
  version INTEGER NOT NULL DEFAULT 0, -- bumped on every change, so two requests can't both spend the same credits
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A browser's session. The token itself is never stored, only its SHA-256.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  play_token TEXT,              -- the Atlesque Play bearer token while signed in
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX sessions_player ON sessions(player_id);

-- Every paid spin and free spin, for stats and auditing.
CREATE TABLE spins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- base | ante | buy | free
  bet REAL NOT NULL,
  cost REAL NOT NULL,
  win REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX spins_player ON spins(player_id, created_at);
