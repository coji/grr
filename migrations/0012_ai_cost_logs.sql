-- AI API call cost tracking
-- Records every AI API call with token usage and estimated cost
CREATE TABLE ai_cost_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,                    -- Associated user (nullable for system-level calls)
  operation TEXT NOT NULL,         -- e.g. 'character_image', 'diary_reply', 'character_concept'
  model TEXT NOT NULL,             -- e.g. 'gemini-3-pro-image-preview', 'gemini-3-flash-preview'
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata TEXT,                   -- JSON for extra context
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ai_cost_logs_user_id ON ai_cost_logs(user_id);
CREATE INDEX idx_ai_cost_logs_operation ON ai_cost_logs(operation);
CREATE INDEX idx_ai_cost_logs_created_at ON ai_cost_logs(created_at);
