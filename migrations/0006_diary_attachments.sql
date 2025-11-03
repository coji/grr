-- Migration number: 0006        2025-11-03T00:00:00.000Z

CREATE TABLE IF NOT EXISTS diary_attachments (
  id TEXT NOT NULL PRIMARY KEY,
  entry_id TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  slack_file_id TEXT NOT NULL,
  slack_url_private TEXT NOT NULL,
  slack_permalink TEXT,
  slack_thumb360 TEXT,
  slack_thumbvideo TEXT,
  width INTEGER,
  height INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS diary_attachments_entry_id ON diary_attachments(entry_id);
CREATE INDEX IF NOT EXISTS diary_attachments_file_type ON diary_attachments(file_type);
CREATE INDEX IF NOT EXISTS diary_attachments_created_at ON diary_attachments(created_at);
