-- Migration: Diary Character System
-- Adds character data to track user's personal companion (Tamagotchi-style)
-- Characters are free-form and unique to each user!

CREATE TABLE IF NOT EXISTS user_characters (
  user_id TEXT PRIMARY KEY,

  -- Character identity (all AI-generated, unique per user)
  character_name TEXT NOT NULL,      -- AI-generated name (e.g., "ぽぽ", "もこ")
  character_species TEXT NOT NULL,   -- AI-generated species (e.g., "コーヒー豆の妖精")
  character_emoji TEXT NOT NULL,     -- Representative emoji
  character_appearance TEXT,         -- Description of appearance
  character_personality TEXT,        -- Personality traits
  character_catchphrase TEXT,        -- Catchphrase

  -- Visual
  character_svg TEXT,                -- Gemini-generated SVG code

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
