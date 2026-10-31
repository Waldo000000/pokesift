# Cloud accounts: deployment and recovery

## Rollout status

The account, migration and sync implementation is behind `POKESIFT_CLOUD_ENABLED=1`.
The default is **off**. The existing QR access and browser collection continue to
work until live Neon authentication, PostgreSQL and private object storage have
been verified. Local fixtures and real PostgreSQL tests pass; they are not proof
that a particular Neon project or Google OAuth client is configured correctly.

Keep the existing Render service and origin. The cloud feature adds Neon; it does
not move the Python app, require a purchased domain, or require database RLS rules.
Each account owns its own collection. Invitations grant scans, never access to
another person's collection.

## Minimal infrastructure setup

1. In Neon, inspect the existing project's region and **Object Storage** availability.
   The earlier Oregon database URL does not establish storage availability. Neon's
   documented storage regions currently include Ohio, N. Virginia, Frankfurt and
   Singapore. If the existing project cannot supply storage, create a separate
   empty project in a supported region after checking the free-project allowance;
   retain the old project. Do not move/delete an existing database as a shortcut.
2. Enable **Neon Auth (Better Auth)** for the intended database/branch. Configure
   **Google** sign-in, disable unused password/email providers, and add exactly
   `https://pokesift-dev.onrender.com` as a trusted application origin. Copy the
   Auth base URL from Neon; it is not the database URL.
3. For testing, shared Google credentials may be sufficient. For friends who are
   not listed test users, configure your own Google OAuth **Web application** client
   using the redirect URI Neon supplies. Use only basic identity scopes, the app
   homepage and `/privacy.html`, and real support/contact details. Publish the
   Google consent configuration as required. A Neon API key cannot create or
   publish the Google OAuth client. This does not require another hosting service.
4. Create a **private** Neon Object Storage bucket. Copy its S3-compatible endpoint,
   bucket, region and scoped access credentials. Give the backend access only to
   that bucket. No public bucket policy or browser CORS policy is needed: bytes
   pass through authenticated Python routes. Do not enable a paid plan implicitly.
5. Save the following in **Render → pokesift-dev → Environment**. Keep the existing
   TCG/PikaQian keys. Keep `POKESIFT_PASSWORD` for rollback while QR mode is off.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon's pooled PostgreSQL connection string, including password. Remote connections enforce certificate and hostname verification. |
| `NEON_AUTH_BASE_URL` | Exact HTTPS Auth URL from Neon, including its database/auth path. |
| `S3_ENDPOINT_URL` | Exact HTTPS endpoint from Neon Object Storage. |
| `S3_BUCKET` | Private bucket name. |
| `S3_REGION` | Bucket region, e.g. `us-east-2`; use the actual value from Neon. |
| `S3_ACCESS_KEY_ID` | Server-side bucket access key. |
| `S3_SECRET_ACCESS_KEY` | Server-side bucket secret. |
| `POKESIFT_CLOUD_ENABLED` | Leave `0` until ready for the controlled activation below. |

`NEON_API_KEY` is a management credential for provisioning, **not** `DATABASE_URL`,
an auth URL or an S3 credential. Keep it in the development environment; the
running app does not need it. Saving/publishing a development-environment secret
does not also install it in Render, and an already running task may still have
the previous environment revision. Check active configuration without printing
secret values.

## Controlled activation

1. Download a complete collection backup from an existing device. Keep that
   browser's storage and the original backup. Do not clear cookies/site data.
2. Test on a temporary development service with the target Neon configuration,
   or enable the flag on the current service for a controlled verification window.
   The development service needs its own trusted origin. Do not invite friends
   until Google, private media and a two-device sync have passed live checks.
3. Set `POKESIFT_CLOUD_ENABLED=1` and deploy. Startup validates configuration and
   applies the idempotent initial schema under a PostgreSQL advisory lock.
   Use `provider_calls_enabled=0` in the access policy for verification that
   must not call paid providers. The new policy enables provider use by default;
   legacy `tcgapi_monthly`/`pikaqian_monthly` zero rows no longer pause accounts. Failure to start is a reason
   to switch the flag back to `0`, not to remove authorization checks.
4. Sign in with Google on desktop and Safari/iPad. Confirm the callback returns
   to the collection, a reload retains the session, and signing out revokes it.
   The Python adapter implements the official Neon server-proxy challenge/verifier
   protocol; verify it against the deployed Auth version before general use.
5. From a trusted shell with the same server-side environment, run:

   ```sh
   python scripts/cloud_admin.py accounts
   python scripts/cloud_admin.py promote-owner --subject '<your verified Neon user ID>'
   ```

   Inspect the identity before promotion. The first visitor never becomes owner
   automatically. Do not place database credentials in shell arguments or chat.
6. Import one device using **Bring these cards into my account**, wait for **Synced**,
   then sign in on a second device. Verify card counts, a Chinese card, raw provider
   observations, valuation choice, foil override, Binder/Zoo layout, a retake and
   its archived photos. Export from the second device and check the image bytes.
   Explicitly import other browsers afterward; QR sessions cannot prove ownership
   or read another device's storage.
7. Exercise an offline edit/reconnect, conflicting edits, removed-card recovery,
   a revoked session and a second account attempting another account's card/media
   URL. No paid provider calls are necessary. Keep source backups until verified.
8. Review **Account → Owner tools → Manage access and invitations**. Public
   accounts get three lifetime scan calls. Their shared pools start at 30 scan
   calls/day and 300/month. Public catalog pools start at 100 calls/day and
   1,000/month, with 15 lifetime catalog calls/account. These limits cap exposure
   across all public Google accounts, rather than multiplying with signup count.
   A busy public pool can delay legitimate trials; requests for approval remain
   available, and owners/approved accounts do not consume that pool.
9. Approved accounts have ongoing access paced at six new scan calls/minute.
   Owners have no lifetime quota and only the two-calls/second burst guard.
   An owner can approve requests by the displayed email or create an invitation
   for a particular Google email. Codes have one use and expire in seven days;
   redemption grants ongoing access, never another person's collection. Legacy
   unbound codes must be replaced with addressed invitations.

   Operator examples (credentials stay in the configured environment):

   ```sh
   python scripts/cloud_admin.py budget --name provider_calls_enabled --amount 0
   python scripts/cloud_admin.py budget --name public_daily --amount 30
   python scripts/cloud_admin.py budget --name approved_per_minute --amount 6
   # Enable connected provider use deliberately:
   python scripts/cloud_admin.py budget --name provider_calls_enabled --amount 1
   ```

## Limits and sync behaviour

- Account approval removes public trial quotas. It does not bypass authorization,
  disabled-account checks, provider backoff, storage limits, or short burst guards.
  Existing approved/invited accounts retain ongoing access. Old finite allowance
  columns and old global monthly budgets are retained for history/rollback; they
  no longer restrict approved accounts or owners.
- Durable reservations count submitted calls, including uncertain outcomes.
  Replaying a completed request ID or an identical photo within five minutes
  reuses its result. Pending/uncertain requests are never silently resubmitted.
  Only an explicit pre-provider `scan_throttled` rejection is automatically
  queued again, with the same request ID and a wait specified by the server.
- Catalog calls have a 30/minute/account burst guard. The legacy process-wide
  60/hour limiter is disabled in cloud mode so one public user cannot exhaust
  it for trusted users. Real provider rate limits and error backoff still apply.
  Signup is limited to 100/day; Google verification alone is not bot detection.
  Public pools bound spending but cannot guarantee availability during an attack.
- Cloud metadata is capped at 1,000 card IDs (including deletion tombstones), 4 MB
  per card/history, 64 MB/account and 512 MB globally. Photos are capped at 8 MB
  each, 512 MB/account and 4 GB globally. Layouts and operation records also consume
  database space; these are application caps, not promises to stay under every
  free-provider quota. Monitor provider usage and retain headroom.
- Cards sync by server revision with durable operation IDs. Disjoint top-level
  edits merge; conflicting values stay available for review. Binder/Zoo arrangements
  are an atomic document: concurrent arrangement edits require a choice, and both
  versions remain in recovery backup data. A second editing tab asks for a reload
  rather than silently overwriting the first tab's durable cache.
- Photo uploads are content-addressed within the account, checksum verified, and
  completed before referencing cards are saved. Missing legacy photos are reported;
  no replacement scan is automatic. Full unknown legacy fields are retained.
- Browsers keep an account-scoped IndexedDB cache. Temporary offline editing works
  after loading the app; this is not an installable offline/service-worker app.
  Photos still require downloading if absent from the device cache.
- Backup version 4 includes archived images, retakes, arrangements and cloud
  conflict/migration recovery data. Import preserves recovery data as an archive;
  it does not silently apply old conflicts or resurrect deleted cards. New accounts
  can restore the ordinary card/image backup through the existing restore UI.

Optional initial policy variables are `POKESIFT_PUBLIC_DAILY_LIMIT`,
`POKESIFT_PUBLIC_MONTHLY_LIMIT` and `POKESIFT_APPROVED_SCANS_PER_MINUTE`.
Values saved by owner tools take precedence and usage survives restarts.
The old `POKESIFT_SCAN_MONTHLY_LIMIT` and `POKESIFT_LOOKUP_MONTHLY_LIMIT`
variables are deprecated and ignored by the new access policy.

## Recovery, maintenance and rollback

Soft-deleted cards can be restored for 30 days. Run maintenance periodically from
a trusted configured shell:

```sh
python scripts/cloud_admin.py cleanup
```

It purges expired card payloads, then removes up to 20 unreferenced expired photos
per run and releases storage reservations. Repeat until `photosRemoved` is zero.
Deletion markers remain to prevent old devices resurrecting cards. Cleanup is
resumable, but is **not automatically scheduled** on the free sleeping Render
service. Photo retention is therefore eligibility after 30 days, not a promise
of deletion at the exact deadline. Operator erasure is separate:

```sh
python scripts/cloud_admin.py erase-account --account-id '<account ID>'
# Inspect the dry-run counts before deliberately executing:
python scripts/cloud_admin.py erase-account --account-id '<account ID>' \
  --execute --confirm-account-id '<same account ID>'
```

Erasure disables sessions, deletes collection/media data and leaves a disabled
identity tombstone to prevent recreation. Delete the corresponding Neon Auth
identity separately. Provider backups follow provider retention policies. Do not
mistake deleting a login identity for deleting collection data, or vice versa.

Cloud sync is not a backup. Keep periodic full in-app exports, a PostgreSQL backup
(`pg_dump` with credentials supplied securely), and a private copy of the bucket's
object bytes using an S3 client. Store backups outside the live bucket/database,
encrypted with access restricted to the owner. Restore a database dump and matching
objects into an isolated test database/bucket, validate image checksums and two
sample exports, then test sign-in separately. This infrastructure restore drill
has not been run against the user's Neon project yet. Confirm provider backup
retention and costs before relying on a free plan's restore history.

To roll back, set `POKESIFT_CLOUD_ENABLED=0` and redeploy. The unchanged legacy
browser collection and QR flow return. Do not delete cloud tables or media.
Cards added only in cloud mode will not appear in the old local collection unless
exported/restored; download cloud backups before a planned rollback. A rollback
must not silently copy another account's data into unscoped local storage.

## Tests and implementation map

```sh
python -m unittest discover -s tests -v
# An isolated expendable PostgreSQL database; never point tests at production:
TEST_POSTGRES_URL='<local test database URL>' python -m unittest tests.test_cloud -v
npm run check
npm run test:cloud
```

The PostgreSQL tests delete test budget/rate records. The browser fixture binds
to loopback and injects identities only in the test process; there is no public
test-login endpoint. All providers are fixtures and migration uses zero scans.

Backend: `cloud_store.py`, `cloud_http.py`, `cloud_media.py`, `neon_auth.py`,
`migrations/001_cloud.sql`. Browser: `cloud-sync.js`, `account.js`, `photo-store.js`.
Operator: `scripts/cloud_admin.py`. The Neon proxy protocol reference is
`@neondatabase/auth` 0.7.0-beta; no Node server dependency was introduced.

References: [Neon Auth](https://neon.com/docs/auth/overview),
[Google OAuth setup](https://neon.com/docs/auth/guides/setup-oauth),
[trusted domains](https://neon.com/docs/auth/guides/configure-domains),
[Object Storage](https://neon.com/docs/storage/overview),
[plans and quotas](https://neon.com/docs/introduction/plans).
