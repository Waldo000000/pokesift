# Accounts, cloud sync and local collection migration

Status: design baseline, 28 October 2026. Implementation now exists behind a disabled feature flag. See [deployment status, exact configuration and recovery](cloud-deployment.md) for the operational source of truth. Live Neon/Google/storage activation remains outstanding.

Implementation choices relative to this design: media is streamed through authenticated Python routes rather than signed URLs; one account directly owns one collection (no unused membership model); complete versioned card JSON is retained without a separate query-index schema; concurrent arrangement conflicts require choosing a retained layout. A managed CAPTCHA and automated backup/cleanup scheduling remain deferred; fixed shared paid budgets fail closed. Cleanup and account erasure are explicit operator commands. The original scope below records the intended behaviour, not a claim that live infrastructure or disaster-recovery drills are complete.

## Outcome

One private collection that follows its owner between phone, tablet and PC. Existing browser collections and backups can join it without photographing cards again or making paid identification/pricing calls. Keep the current camera, collection, Binder, Fan and Zoo experiences.

## Recommended architecture

Settled hosting direction: retain the existing Render Python app and its current public address. Use one additional provider, Neon Free, for PostgreSQL, private Object Storage and managed Better Auth with Google sign-in. No Cloudflare compute migration, TypeScript backend port, Firebase, Clerk or purchased domain is planned. The browser accesses collection data through the Python API, not directly through a database SDK; PostgreSQL row-level security policies are not a prerequisite. Confirm all required Neon features are available in the chosen project before live integration. Keeping the current origin lets the migration read that browser's existing localStorage and IndexedDB directly; each device must still sign in and migrate separately.

The Python backend remains the authorization boundary for collection operations and paid providers. Use managed authentication to verify the owner, with secure HttpOnly app sessions; keep privileged database/storage credentials and provider keys server-side. Enforce ownership centrally on every record and media request in the backend; PostgreSQL row-level security policies are not a prerequisite for this architecture. Test every endpoint for cross-account access, and use narrowly scoped database credentials. Signed upload/download URLs must be short-lived and limited to an authorized object; buckets stay private.

Model accounts, collections, memberships, devices/sessions, cards, media, provider observations, arrangements and migration batches. Start with one owner and one collection per account; membership structure leaves room for future sharing without exposing sharing controls now. Store queryable card fields alongside a versioned JSON document so migration preserves unfamiliar/legacy fields. Provider observations and scan history are append-only, with stable IDs. Store image bytes separately from database rows.

## Included user experience

- Standard account entry via **Continue with Google**, backed by Neon managed Better Auth. Google handles identity and account recovery; PokéSift does not send verification/reset emails or manage user passwords. Account creation remains open to public users, with paid scan entitlement limited separately. Validate the identity provider's verified-email claim where used for entitlement; never trust a browser-supplied email or account ID. Google supplies an email address as part of identity, but the app does not send mail. Support for users without a Google account is deferred.
- Replace QR device pairing with signing into the same account on each device. Support session revocation. Existing app-wide sessions are not proof of ownership and cannot silently become owner accounts.
- Owners can create a single-use seven-day invitation link for a specific Google email. The invite grants ongoing scan access to the recipient's own account; it does not sign them in as the sender or share the sender's collection. Account creation, invitations and scan access are separate concepts. See allowances below.
- Add a small sync indicator: **Saved on this device**, **Syncing**, **Synced**, or an actionable failure. Never claim a photo is backed up before its upload is verified.
- Save edits locally first and sync in the background. Support queued changes through temporary connection loss; remote updates arrive without interrupting capture or gestures. Scanning still requires connectivity. Offline app installation/service-worker support is outside this phase.
- Preserve complete export/restore. Cloud exports must include archived images even when they are no longer cached on the exporting device. Signed download URLs are not portable backup content.

## Migration and preservation

1. Establish the owner's account and cloud collection through a controlled initial setup. Sign into the same account on each existing device separately; one device cannot read another browser's storage.
2. Offer **Bring this device's cards into my collection**, showing card/photo counts and any known missing images. Preserve the local source and offer a downloadable backup before migration.
3. Stage a resumable upload with a manifest, stable IDs, byte sizes and image checksums. Retrying a batch is idempotent. Verify records and photos before marking it complete; interrupted uploads remain visibly incomplete and can resume.
4. Preserve entries, IDs, dates, statuses, thumbnails, canonical image references/embedded bytes, scan-quality photos, retake history, capture/crop metadata, identification responses, provider IDs/observations, pricing currencies and assumptions, selected quotes, manual species assignments, visual finish overrides, Binder slots/piles and Zoo positions. Preserve FX cache/provenance in migration/export; current display conversion continues refreshing normally. Motion and camera preferences stay device-local.
5. Merge copies of the same entry ID once. If the same ID has differing content, preserve both versions for resolution; do not silently overwrite. Different IDs remain separate physical cards even if name, printing or photo is identical. Image bytes can be deduplicated without merging cards.
6. Preserve the first imported Binder arrangement; put additional unplaced cards in a pile. Keep existing Zoo positions, adding previously unseen species through the normal layout rules. Do not silently replace the entire arrangement from a second device.
7. Keep existing cloud deletion markers effective: importing an old backup must not silently resurrect deleted cards. Explicit recovery is a separate action.

The archive contains the exact prepared scan upload (up to 2048 pixels / 8 MB), not the full original camera frame. Older missing images cannot be reconstructed. Migration must report gaps and preserve thumbnails/metadata; it must never spend credits to fill those gaps automatically. Keep canonical image references unless existing storage rights permit copying the bytes. Review provider retention terms before enabling cloud persistence of observations; do not promise unrestricted catalog mirroring.

## Sync and recovery rules

Use a local IndexedDB cache and durable outgoing operation queue, scoped to account/collection. Version server records and reject stale updates rather than replacing a whole collection snapshot. Idempotency keys prevent retrying a write from creating duplicate cards.

Merge independent field edits; retain both versions when the same field conflicts. Append observations/history rather than overwriting them. Apply Binder moves atomically so a card cannot occupy two places or overwrite another card's slot; on concurrent moves, retain the user's pending intent and offer a retry against the latest layout. Use server revisions instead of trusting device clocks.

Use deletion markers and an initial 30-day recovery window for cards/photos, followed by cleanup. Deleting the account needs a separate explicit flow and documented backup-retention limits. Sign-out/account switching must never expose another account's cached data or silently discard unsynced changes; offer sync or backup first, then clear account-scoped caches and sessions.

Persist scan request identifiers/outcomes so reconnecting does not automatically submit a paid request twice. If a provider call's outcome is uncertain, surface that uncertainty and require an intentional retry. Sync, migration and restore never initiate paid scans or price lookups. Move app allowances to durable per-account/device counters without reintroducing the old ten-scans-per-hour cap.

## Signup, invitations and scan spending

Public Google accounts get three lifetime scan calls. Shared public pools cap all
trial accounts together at 30 scan calls/day and 300/month, plus 100 catalog
calls/day and 1,000/month (15 catalog calls per trial account). Account farms
cannot multiply these pools. Exhaustion can temporarily block a legitimate
public trial, so requesting approval stays available without provider use.

Approved and invited accounts have ongoing access with six new scan calls/minute
and no lifetime quota. The owner has no lifetime quota or minute quota; the
two-calls/second burst guard still applies. Storage, account isolation, disabled
accounts, provider limits and error backoff apply to everyone.

Owner tools show requests beside verified account emails and grant or remove
ongoing access. Invitations are bound to a specified Google email, single-use
and valid for seven days. Redemption upgrades the recipient's own account; it
never shares a collection or grants owner privileges. Expiry does not revoke
access already granted. Legacy unbound codes cannot grant the stronger access.

An explicit owner pause stops new provider calls for every tier. Old zero-valued
global monthly budgets are replaced by this control and public-only pools.
Provider use is enabled by default under this policy, using the existing keys
and credits without changing purchased plans. Operators can set
`provider_calls_enabled=0` before isolated verification.

Paid requests are reserved atomically across instances. Duplicate request IDs
replay completed results; identical account-scoped photos are reused for five
minutes. Uncertain provider outcomes never cause an automatic retry. Only a
known pre-provider throttle rejection may rejoin the queue after Retry-After.
Google verification is not bot detection; public pools bound cost rather than
guaranteeing access during an attack. No shared-household IP quota is imposed.

## Delivery sequence

1. Foundation: database/storage services, schema, ownership enforcement, account signup/sign-in/recovery, week-long invitations, durable scan budgets, session revocation and private media access.
2. Migration: complete manifests, resumable uploads, cross-device merge and cloud-aware backup/restore; validate against representative existing backups.
3. Sync: replace whole-localStorage saves with the local repository/operation queue; integrate scan results, edits, deletions and arrangements with cross-device updates.
4. Rollout: feature flag, migrate one device, verify a second device, test restoration and interrupted uploads, then enable as the normal collection path. Keep local sources intact until verification succeeds.

Completion requires tests covering ownership isolation, expired/revoked/exhausted invites, repeated or concurrent invite redemption, signup abuse, concurrent scan budget reservations, session revocation, blocked cross-account media access, two-device changes, concurrent edits/moves, deletion resurrection, offline/reconnect, upload interruption, repeated migration, missing photos, backup round-trips and zero provider calls during migration. Test recovery from both a database backup and media backup; cloud sync alone is not a backup strategy.

## Setup and running costs

Needs a Neon Free project in a region supporting Object Storage (Ohio is documented), managed Better Auth enabled, a private bucket, and backend database/auth/storage configuration in Render. Add exactly https://pokesift-dev.onrender.com as an allowed app origin. Production Google sign-in needs a Google Cloud OAuth web client configured with the callback URL supplied by Neon; shared Google credentials are for development. Configure only basic identity scopes, support/contact information, required app/privacy pages and the consent-screen audience. Testing mode permits only listed test users: publish appropriately before inviting unknown recipients, completing any review Google requires. This is an identity configuration, not a second hosting provider. No custom email provider is needed for Google-only accounts. Store credentials securely; do not commit them or share secrets in chat.

The earlier Cloudflare proposal is withdrawn: no Workers, D1 or R2 setup or Render retirement is required. Existing Render service limitations still apply.

Photos dominate capacity and bandwidth: 1,000 archived images averaging 1 MB use roughly 1 GB before retakes and backup copies. Measure actual photo sizes and counts before choosing a plan. As checked on 28 October 2026, Neon Free lists 1 GB database storage, 100 CU-hours/month per project and 5 GB object storage. Object storage is region-limited; Ohio is a documented supported region. This supersedes the earlier suggestion to choose Oregon for a new all-in-one Neon project. If a project already exists in another region, inspect it before proposing any move; never replace or delete it automatically. Neon Free currently lists up to 60,000 monthly active auth users. Google-only sign-in avoids dependence on Neon's shared development email sender. Verify current provider quotas, backups and feature availability at implementation; free tiers are bounded and not an uptime/forever-free guarantee. Do not enable paid plans automatically. Render remains in place, with its existing service limitations.

## Not included

Collection health checks, foil improvements, public profiles, trading, social sharing, family permissions, payments, a frontend rewrite, or automatic paid reprocessing. These can be scoped separately.

Budget references checked 28 October 2026: [Neon plans](https://neon.com/docs/introduction/plans), [Neon storage and supported regions](https://neon.com/docs/storage/overview), [Neon OAuth configuration](https://neon.com/docs/auth/guides/setup-oauth), [Neon trusted domains](https://neon.com/docs/auth/guides/configure-domains). Neon shared email delivery is documented for development/testing; it is not used by the proposed Google-only account flow.
