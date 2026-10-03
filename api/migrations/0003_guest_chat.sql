ALTER TABLE conversations ADD COLUMN guest_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_guest_token
ON conversations(guest_token);
