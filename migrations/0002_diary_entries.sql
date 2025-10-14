-- Migration number: 0002        2025-05-15T00:00:00.000Z

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  mood_emoji TEXT,
  mood_value INTEGER,
  mood_label TEXT,
  detail TEXT,
  reminder_sent_at TEXT NOT NULL,
  mood_recorded_at TEXT,
  detail_recorded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS diary_entries_user_date ON diary_entries(user_id, entry_date);
CREATE UNIQUE INDEX IF NOT EXISTS diary_entries_message_ts ON diary_entries(message_ts);
