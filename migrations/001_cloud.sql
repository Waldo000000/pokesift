-- Shared PostgreSQL/SQLite schema. Application queries always scope data to owner_id.
CREATE TABLE IF NOT EXISTS cloud_schema (version INTEGER PRIMARY KEY);
INSERT INTO cloud_schema(version) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS cloud_mutex (id INTEGER PRIMARY KEY, marker INTEGER NOT NULL DEFAULT 0);
INSERT INTO cloud_mutex(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS cloud_accounts (
 id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'member', tier TEXT NOT NULL DEFAULT 'public', allowance INTEGER NOT NULL DEFAULT 3,
 spent INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_sessions (
 token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES cloud_accounts(id), expires_at BIGINT NOT NULL,
 created_at BIGINT NOT NULL, label TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cloud_sessions_owner ON cloud_sessions(owner_id);
CREATE TABLE IF NOT EXISTS cloud_login_states (
 token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_cards (
 owner_id TEXT NOT NULL REFERENCES cloud_accounts(id), id TEXT NOT NULL, revision INTEGER NOT NULL,
 document TEXT NOT NULL, deleted_at BIGINT, updated_at BIGINT NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS cloud_layouts (
 owner_id TEXT PRIMARY KEY REFERENCES cloud_accounts(id), revision INTEGER NOT NULL,
 document TEXT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_operations (
 owner_id TEXT NOT NULL REFERENCES cloud_accounts(id), id TEXT NOT NULL, request_hash TEXT NOT NULL,
 response TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS cloud_media (
 owner_id TEXT NOT NULL REFERENCES cloud_accounts(id), hash TEXT NOT NULL, bytes BIGINT NOT NULL,
 mime TEXT NOT NULL, state TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(owner_id,hash)
);
CREATE TABLE IF NOT EXISTS cloud_migrations (
 owner_id TEXT NOT NULL REFERENCES cloud_accounts(id), id TEXT NOT NULL, manifest TEXT NOT NULL,
 state TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS cloud_invites (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES cloud_accounts(id),
 expires_at BIGINT NOT NULL, max_uses INTEGER NOT NULL, allowance INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_redemptions (
 invite_id TEXT NOT NULL REFERENCES cloud_invites(id), owner_id TEXT NOT NULL REFERENCES cloud_accounts(id),
 created_at BIGINT NOT NULL, PRIMARY KEY(invite_id,owner_id)
);
CREATE TABLE IF NOT EXISTS cloud_paid_requests (
 owner_id TEXT NOT NULL REFERENCES cloud_accounts(id), id TEXT NOT NULL, provider TEXT NOT NULL,
 fingerprint TEXT NOT NULL, state TEXT NOT NULL, response TEXT, status INTEGER,
 created_at BIGINT NOT NULL, PRIMARY KEY(owner_id,id,provider)
);
CREATE INDEX IF NOT EXISTS cloud_paid_period ON cloud_paid_requests(provider,created_at);
CREATE TABLE IF NOT EXISTS cloud_budgets (
 name TEXT PRIMARY KEY, amount INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_usage (
 name TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cloud_rate_limits (
 name TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_requests (
 owner_id TEXT PRIMARY KEY REFERENCES cloud_accounts(id), note TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL,
 details TEXT NOT NULL, created_at BIGINT NOT NULL
);
