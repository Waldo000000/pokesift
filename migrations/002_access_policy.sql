-- Email-bound invitations grant ongoing access. Keep legacy invitation rows
-- for history; unbound legacy codes cannot grant this stronger access level.
CREATE TABLE IF NOT EXISTS cloud_invite_recipients (
 invite_id TEXT PRIMARY KEY REFERENCES cloud_invites(id), email TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cloud_invite_recipient_email ON cloud_invite_recipients(email);
CREATE INDEX IF NOT EXISTS cloud_paid_photo_replay ON cloud_paid_requests(owner_id,provider,fingerprint,created_at);
INSERT INTO cloud_schema(version) VALUES (2) ON CONFLICT DO NOTHING;
