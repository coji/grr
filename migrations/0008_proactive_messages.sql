-- Proactive messages tracking for HEARTBEAT feature
-- This table tracks all types of proactive messages sent to users
-- to avoid sending duplicates and manage frequency

CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_type TEXT NOT NULL,  -- 'anniversary' | 'milestone' | 'weekly_insight' | 'seasonal' | 'random_checkin' | 'monthly_report' | 'question' | 'brief_followup'
  message_key TEXT,            -- Unique key to prevent duplicates (e.g., "anniversary:2025-02-19" or "milestone:100posts")
  metadata TEXT,               -- JSON for type-specific data
  message_ts TEXT,             -- Slack message timestamp
  sent_at TEXT NOT NULL,       -- When the message was sent
  created_at TEXT NOT NULL
);

-- Index for finding recent messages by user
CREATE INDEX IF NOT EXISTS idx_proactive_messages_user_sent ON proactive_messages(user_id, sent_at);

-- Index for finding messages by type and key (duplicate prevention)
CREATE INDEX IF NOT EXISTS idx_proactive_messages_type_key ON proactive_messages(message_type, message_key);

-- User milestones tracking (persistent stats for milestone detection)
CREATE TABLE IF NOT EXISTS user_milestones (
  user_id TEXT PRIMARY KEY,
  total_entries INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_entry_date TEXT,        -- YYYY-MM-DD
  first_entry_date TEXT,       -- YYYY-MM-DD (for anniversary calculation)
  last_milestone_celebrated TEXT,  -- JSON array of celebrated milestones
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
