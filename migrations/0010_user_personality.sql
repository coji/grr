-- Migration: User Personality System
-- Adds personality columns to user_diary_settings for storing AI-generated personality summaries

-- Personality summary (AI-generated from memories)
ALTER TABLE user_diary_settings ADD COLUMN personality TEXT;

-- When the personality was last updated
ALTER TABLE user_diary_settings ADD COLUMN personality_updated_at TEXT;

-- Flag to indicate a personality change that should be mentioned in the next daily reflection
-- 0 = no pending change, 1 = change pending
ALTER TABLE user_diary_settings ADD COLUMN personality_change_pending INTEGER DEFAULT 0;
