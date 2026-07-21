-- arcade leaderboard schema (Cloudflare D1 / SQLite)
-- One row per player per board; lower score is better for every game.

CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT    NOT NULL,          -- wordle / minesweeper / 2048 / flowcode
  board      TEXT    NOT NULL,          -- wordle: daily-<day>; minesweeper: beginner/intermediate/expert; flowcode: <mode>-<day>
  player     TEXT    NOT NULL,          -- client-generated id, one row per player per board
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,          -- sortable rank key, lower is better
  detail     TEXT    NOT NULL DEFAULT '{}',  -- game-specific extras (guesses, timeMs, ...)
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_board_player ON scores (game, board, player);
CREATE INDEX IF NOT EXISTS idx_scores_board_score ON scores (game, board, score ASC);

-- Per-caller submission throttle. The column holds a salted SHA-256 prefix of
-- the address, never the address itself, and the salt rotates daily; rows are
-- pruned a few days after they stop mattering.
CREATE TABLE IF NOT EXISTS rate (
  ip  TEXT    NOT NULL,           -- hashed caller key, not an IP address
  day INTEGER NOT NULL,
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);
