-- FTS5 for diary entries using Intl.Segmenter-based word tokenization
-- Based on: https://zenn.dev/coji/articles/cloudflare-d1-fts5-japanese-search-api
--
-- Key design:
-- - Uses unicode61 tokenizer (splits on spaces)
-- - Stores pre-tokenized text from Intl.Segmenter (app-side)
-- - No triggers (tokenization must be done in application code)
-- - See: app/services/diary-search.ts for tokenize() and index functions

CREATE VIRTUAL TABLE IF NOT EXISTS diary_entries_fts USING fts5(
  entry_id UNINDEXED,
  user_id UNINDEXED,
  entry_date UNINDEXED,
  detail,
  tokenize='unicode61'
);

-- Note: Existing entries must be indexed via rebuildFtsIndex()
-- in app/services/diary-search.ts after migration
