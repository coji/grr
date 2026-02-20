-- Migration: User Memories System
-- Adds tables for storing and managing user memories extracted from diary entries

-- Core memory storage table
CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,        -- 'fact' | 'preference' | 'pattern' | 'relationship' | 'goal' | 'emotion_trigger'
  category TEXT,                     -- 'work' | 'health' | 'hobby' | 'family' | 'personal' | 'general'
  content TEXT NOT NULL,
  source_entry_ids TEXT,            -- JSON array of entry IDs that contributed to this memory
  confidence REAL DEFAULT 1.0,      -- How confident we are (0.0-1.0)
  importance INTEGER DEFAULT 5,     -- Priority 1-10 for retrieval
  first_observed_at TEXT NOT NULL,  -- When this was first noticed
  last_confirmed_at TEXT NOT NULL,  -- Last time this was validated/seen again
  mention_count INTEGER DEFAULT 1,  -- How many times this has come up
  is_active INTEGER DEFAULT 1,      -- Soft delete / superseded memories
  superseded_by TEXT,               -- ID of newer memory that replaced this
  user_confirmed INTEGER DEFAULT 0, -- User explicitly confirmed this
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Indexes for efficient memory retrieval
CREATE INDEX IF NOT EXISTS idx_user_memories_user_type ON user_memories(user_id, memory_type, is_active);
CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(user_id, category, is_active);
CREATE INDEX IF NOT EXISTS idx_user_memories_importance ON user_memories(user_id, importance DESC, is_active);
CREATE INDEX IF NOT EXISTS idx_user_memories_recent ON user_memories(user_id, last_confirmed_at DESC, is_active);

-- Memory extraction job tracking table
CREATE TABLE IF NOT EXISTS memory_extractions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- 'pending' | 'processing' | 'completed' | 'failed'
  extracted_memories TEXT,          -- JSON array of extracted memory objects
  processing_notes TEXT,            -- Any notes from extraction
  created_at TEXT NOT NULL,
  processed_at TEXT
);

-- Indexes for extraction job management
CREATE INDEX IF NOT EXISTS idx_memory_extractions_status ON memory_extractions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_extractions_user ON memory_extractions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_extractions_entry ON memory_extractions(entry_id);

-- Pre-computed memory context cache for faster retrieval
CREATE TABLE IF NOT EXISTS memory_context_cache (
  user_id TEXT PRIMARY KEY,
  context_summary TEXT NOT NULL,    -- Pre-built prompt context string
  memory_snapshot TEXT NOT NULL,    -- JSON of key memories for quick access
  last_updated_at TEXT NOT NULL,
  invalidated_at TEXT               -- Set when new memories added; cleared on rebuild
);
