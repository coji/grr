-- Add decoration status to character items
-- is_decorated: 1 if the item is displayed/decorated, 0 otherwise
-- decorated_at: timestamp when the item was decorated

ALTER TABLE character_items ADD COLUMN is_decorated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE character_items ADD COLUMN decorated_at TEXT;

CREATE INDEX idx_items_decorated ON character_items(owner_user_id, is_decorated);
