PRAGMA foreign_keys=OFF;

CREATE TABLE conversations_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    guest_token TEXT,
    guest_name TEXT,
    guest_contact TEXT,
    FOREIGN KEY(account_id) REFERENCES accounts(id)
);

INSERT INTO conversations_new
(id, account_id, status, created_at, guest_token)
SELECT
    id,
    account_id,
    status,
    created_at,
    guest_token
FROM conversations;

DROP TABLE conversations;

ALTER TABLE conversations_new RENAME TO conversations;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_guest_token
ON conversations(guest_token);

CREATE INDEX IF NOT EXISTS idx_conversations_account
ON conversations(account_id);

CREATE TABLE messages_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_account_id INTEGER,
    message_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    FOREIGN KEY(sender_account_id) REFERENCES accounts(id)
);

INSERT INTO messages_new
(id, conversation_id, sender_account_id, message_text, created_at)
SELECT
    id,
    conversation_id,
    sender_account_id,
    message_text,
    created_at
FROM messages;

DROP TABLE messages;

ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_conversation
ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_sender
ON messages(sender_account_id);

PRAGMA foreign_keys=ON;
