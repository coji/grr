-- Migration number: 0007        2026-02-19T00:00:00.000Z

-- Heartbeat feature: stores pending follow-up reminders
-- When a user mentions a future event (e.g., "明日プレゼンがある"),
-- we schedule a follow-up to ask "どうだった？" the next day.

CREATE TABLE IF NOT EXISTS pending_followups (
  id TEXT NOT NULL PRIMARY KEY,
  entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  event_description TEXT NOT NULL,
  event_date TEXT NOT NULL,
  follow_up_date TEXT NOT NULL,
  follow_up_type TEXT NOT NULL DEFAULT 'how_did_it_go',
  message_ts TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES diary_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pending_followups_user_id ON pending_followups(user_id);
CREATE INDEX IF NOT EXISTS pending_followups_follow_up_date ON pending_followups(follow_up_date);
CREATE INDEX IF NOT EXISTS pending_followups_status ON pending_followups(status);
CREATE INDEX IF NOT EXISTS pending_followups_user_date_status ON pending_followups(user_id, follow_up_date, status);
