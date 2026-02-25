-- Character social interactions: encounters, adventures, items
-- Enables characters from the same workspace to interact with each other

-- Add workspace tracking and interaction opt-out to user_characters
ALTER TABLE user_characters ADD COLUMN workspace_id TEXT;
ALTER TABLE user_characters ADD COLUMN interaction_enabled INTEGER NOT NULL DEFAULT 1;

-- Encounter log: random meetings between two characters
CREATE TABLE character_encounters (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  character_a_user_id TEXT NOT NULL,
  character_b_user_id TEXT NOT NULL,
  encounter_type TEXT NOT NULL DEFAULT 'random_meeting',
  location_channel_id TEXT,
  location_name TEXT,
  episode_text TEXT NOT NULL,
  read_by_a INTEGER NOT NULL DEFAULT 0,
  read_by_b INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_encounters_workspace ON character_encounters(workspace_id);
CREATE INDEX idx_encounters_user_a ON character_encounters(character_a_user_id);
CREATE INDEX idx_encounters_user_b ON character_encounters(character_b_user_id);

-- Group adventures: weekly team events
CREATE TABLE character_adventures (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  theme_name TEXT NOT NULL,
  theme_emoji TEXT NOT NULL,
  main_episode TEXT NOT NULL,
  participant_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_adventures_workspace ON character_adventures(workspace_id);

-- Adventure participants and their roles
CREATE TABLE character_adventure_participants (
  id TEXT PRIMARY KEY,
  adventure_id TEXT NOT NULL,
  character_user_id TEXT NOT NULL,
  role_text TEXT NOT NULL,
  highlight_text TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  UNIQUE(adventure_id, character_user_id)
);

CREATE INDEX idx_adventure_participants_adventure ON character_adventure_participants(adventure_id);
CREATE INDEX idx_adventure_participants_user ON character_adventure_participants(character_user_id);

-- Character items: collectible items that can be gifted
CREATE TABLE character_items (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_emoji TEXT NOT NULL,
  item_category TEXT NOT NULL,
  item_description TEXT,
  found_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_from_user_id TEXT,
  gifted_to_user_id TEXT,
  gifted_at TEXT
);

CREATE INDEX idx_items_owner ON character_items(owner_user_id);
CREATE INDEX idx_items_workspace ON character_items(workspace_id);
