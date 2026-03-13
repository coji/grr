-- Migration: 0018_diary_music
-- Description: Add table for storing AI-generated music from diary entries

CREATE TABLE diary_music_generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Target period
  period_start TEXT NOT NULL,  -- YYYY-MM-DD
  period_end TEXT NOT NULL,    -- YYYY-MM-DD
  period_label TEXT NOT NULL,  -- "2026年2月" etc

  -- Generated content
  theme TEXT NOT NULL,         -- Extracted theme
  mood_summary TEXT NOT NULL,  -- Emotion summary
  lyrics TEXT NOT NULL,        -- Generated lyrics
  music_style TEXT NOT NULL,   -- Suno prompt style
  music_title TEXT NOT NULL,   -- Song title

  -- Suno API integration
  suno_task_id TEXT,           -- Suno API task ID
  suno_audio_url TEXT,         -- Generated music URL
  suno_video_url TEXT,         -- (optional) Video URL

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/generating/completed/failed
  error_message TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,

  -- Constraints
  UNIQUE(user_id, period_label)
);

-- Indexes for efficient queries
CREATE INDEX idx_diary_music_user ON diary_music_generations(user_id);
CREATE INDEX idx_diary_music_status ON diary_music_generations(status);
CREATE INDEX idx_diary_music_user_created ON diary_music_generations(user_id, created_at DESC);
