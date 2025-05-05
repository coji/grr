-- Migration number: 0001 	 2025-05-05T12:11:46.920Z

-- イライラ記録
CREATE TABLE IF NOT EXISTS irritations (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  channel_id  TEXT,
  raw_text    TEXT    NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,  -- 記録日時
  updated_at  TEXT    NOT NULL,  -- 更新日時
  is_public   INTEGER NOT NULL DEFAULT 1
);
