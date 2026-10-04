ALTER TABLE jobs ADD COLUMN conversation_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_jobs_conversation
ON jobs(conversation_id);
