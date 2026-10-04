ALTER TABLE jobs ADD COLUMN price_amount REAL;
ALTER TABLE jobs ADD COLUMN deadline TEXT;

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_account_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(actor_account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
ON audit_logs(created_at);
