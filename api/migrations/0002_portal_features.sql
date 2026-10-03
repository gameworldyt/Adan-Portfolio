CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    guest_name TEXT,
    guest_contact TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_account_id INTEGER,
    message_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    FOREIGN KEY(sender_account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    project_id INTEGER,
    experience_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_reviews_account
ON reviews(account_id);

CREATE INDEX IF NOT EXISTS idx_sessions_account
ON sessions(account_id);

CREATE INDEX IF NOT EXISTS idx_conversations_account
ON conversations(account_id);
