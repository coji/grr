CREATE TABLE ai_daily_reflections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT,
  entry_date TEXT NOT NULL,
  reflection TEXT NOT NULL,
  source_entry_ids TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ai_daily_reflections_user_date_idx
  ON ai_daily_reflections (user_id, entry_date);
