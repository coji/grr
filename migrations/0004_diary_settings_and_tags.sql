-- Migration number: 0004        2025-10-16T00:00:00.000Z

-- ユーザーごとの日記設定テーブル
CREATE TABLE IF NOT EXISTS user_diary_settings (
  user_id TEXT NOT NULL PRIMARY KEY,
  reminder_hour INTEGER NOT NULL DEFAULT 13,
  reminder_enabled INTEGER NOT NULL DEFAULT 1,
  skip_weekends INTEGER NOT NULL DEFAULT 0,
  diary_channel_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 日記エントリのタグテーブル
CREATE TABLE IF NOT EXISTS diary_tags (
  id TEXT NOT NULL PRIMARY KEY,
  entry_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS diary_tags_entry_id ON diary_tags(entry_id);
CREATE INDEX IF NOT EXISTS diary_tags_tag_name ON diary_tags(tag_name);
CREATE UNIQUE INDEX IF NOT EXISTS diary_tags_entry_tag ON diary_tags(entry_id, tag_name);
