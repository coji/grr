-- Migration: Diary Character System
-- Adds character data to track user's personal companion (Tamagotchi-style)

CREATE TABLE IF NOT EXISTS user_characters (
  user_id TEXT PRIMARY KEY,

  -- Character identity
  character_type TEXT NOT NULL,    -- 'firefly' | 'moon_rabbit' | 'cloud_sprite' | 'forest_spirit'
  character_name TEXT,             -- User-given name (optional)
  character_emoji TEXT NOT NULL,   -- Current display emoji based on evolution stage
  character_svg TEXT,              -- Gemini-generated SVG code

  -- Evolution state
  evolution_stage INTEGER DEFAULT 1,  -- 1=egg, 2=baby, 3=child, 4=adult, 5=mature
  evolution_points INTEGER DEFAULT 0, -- Points toward next evolution

  -- Status
  happiness INTEGER DEFAULT 50,    -- 0-100
  energy INTEGER DEFAULT 50,       -- 0-100
  bond_level INTEGER DEFAULT 0,    -- 0-100, grows with interaction

  -- Activity tracking
  last_interacted_at TEXT,
  days_without_diary INTEGER DEFAULT 0,

  -- Personality derived from diary
  character_traits TEXT,           -- JSON: traits derived from diary content
  favorite_topics TEXT,            -- JSON: topics character likes (from memories)

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Interaction log for tracking nurturing activities
CREATE TABLE IF NOT EXISTS character_interactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,   -- 'pet' | 'talk' | 'diary_entry' | 'mood_recorded'
  points_earned INTEGER DEFAULT 0,
  metadata TEXT,                    -- JSON: additional context
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_character_interactions_user
  ON character_interactions(user_id, created_at DESC);
