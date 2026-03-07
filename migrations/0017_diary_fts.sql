-- Create FTS5 virtual table for full-text search on diary entries
-- Using trigram tokenizer for better Japanese text search support
CREATE VIRTUAL TABLE IF NOT EXISTS diary_entries_fts USING fts5(
  entry_id UNINDEXED,
  user_id UNINDEXED,
  entry_date UNINDEXED,
  detail,
  tokenize='trigram'
);

-- Populate FTS table with existing diary entries
INSERT INTO diary_entries_fts (entry_id, user_id, entry_date, detail)
SELECT id, user_id, entry_date, detail
FROM diary_entries
WHERE detail IS NOT NULL AND detail != '';

-- Trigger to insert into FTS when a new diary entry is created
CREATE TRIGGER IF NOT EXISTS diary_entries_fts_insert
AFTER INSERT ON diary_entries
WHEN NEW.detail IS NOT NULL AND NEW.detail != ''
BEGIN
  INSERT INTO diary_entries_fts (entry_id, user_id, entry_date, detail)
  VALUES (NEW.id, NEW.user_id, NEW.entry_date, NEW.detail);
END;

-- Trigger to update FTS when diary entry detail is updated
CREATE TRIGGER IF NOT EXISTS diary_entries_fts_update
AFTER UPDATE OF detail ON diary_entries
WHEN NEW.detail IS NOT NULL AND NEW.detail != ''
BEGIN
  DELETE FROM diary_entries_fts WHERE entry_id = OLD.id;
  INSERT INTO diary_entries_fts (entry_id, user_id, entry_date, detail)
  VALUES (NEW.id, NEW.user_id, NEW.entry_date, NEW.detail);
END;

-- Trigger to delete from FTS when diary entry is deleted
CREATE TRIGGER IF NOT EXISTS diary_entries_fts_delete
AFTER DELETE ON diary_entries
BEGIN
  DELETE FROM diary_entries_fts WHERE entry_id = OLD.id;
END;

-- Trigger to delete from FTS when detail is set to NULL or empty
CREATE TRIGGER IF NOT EXISTS diary_entries_fts_clear
AFTER UPDATE OF detail ON diary_entries
WHEN NEW.detail IS NULL OR NEW.detail = ''
BEGIN
  DELETE FROM diary_entries_fts WHERE entry_id = OLD.id;
END;
