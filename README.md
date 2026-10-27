# PokéSift

A password-protected, camera-first Pokémon collection app with background identification, canonical card images and AUD valuations.

## Render setup

In the `pokesift-dev` service's **Environment** settings, set these server-side secrets:

- `TCGAPI_KEY`: the TCG API key. Never use a frontend/public variable or put it in GitHub.
- `POKESIFT_PASSWORD`: a different password-manager-generated password, at least 16 characters. Do not reuse the API key.

Save the environment and deploy the latest `main` commit. Cloud task secrets are separate from Render secrets; configuring one does not configure the other. The app returns 503 until both secrets are configured. `/healthz` remains available for hosting health checks and reveals no configuration details.

Open a fresh pairing QR once to remember a device for 30 days. There is no password prompt. A paired device can choose **Add another device** to generate a new QR inside the app. For bootstrap/recovery, securely inject the existing `POKESIFT_PASSWORD` into `scripts/create_invite.py --origin https://pokesift-dev.onrender.com --output /private/path/invite.svg`. Never put the password in command arguments or Git. The QR itself is a temporary bearer credential; do not commit it either.

Invites are reusable for ten minutes. They carry an HMAC-SHA256 signature derived from the environment password with purpose separation; invite and session tokens cannot be substituted for each other. Both token types are bound to the exact app origin and expiry. The QR carries the invite in a URL fragment, which is removed immediately by the page and exchanged via a same-origin HTTPS POST. It is never stored in localStorage. Production sessions use a `__Host-` cookie with Secure, HttpOnly, SameSite=Strict, Path=/ and a 30-day expiry. Existing sessions survive deployments with the same password. Password rotation revokes all sessions and invites. Sign out clears this browser's cookie; it does not revoke a stolen copy or erase local collection data. This stateless development design has no per-device revocation database.

`render.yaml` configures a free Python service and deployment on `main` commits. GitHub must be connected to Render for automatic deploys; otherwise use Manual Deploy. Free instances can sleep. The old `.openai/hosting.json` is historical and unused.

## Protections and limits

- The static sign-in shell and health checks are public and contain no secrets. Scanning, catalog images, rates and creating invites require a signed device session. No HTTP Basic authentication challenges are sent.
- Missing/short passwords, identical API key and password, or a missing API key fail closed.
- Same-origin POST checks, exact deployment Host validation, no CORS grant, no automatic redirects or retries, and TLS verification for the fixed provider endpoint.
- API key comes only from the server environment; client `X-API-Key` headers cannot override it. Provider key echoes are redacted server-side, including JSON-escaped strings.
- No application request logging, analytics, or API keys in browser storage. Capture thumbnails, catalog images and card details are stored locally as part of the collection; full-resolution uploads are not retained by the backend. Hosting/provider policies and browser credential caching are separate. Keep platform request-body/header logging disabled.
- Images limited to 8 MB; response size capped; concurrent requests bounded. A shared budget permits at most 10 provider attempts per hour per process, including failures. This budget resets on restarts and is not a durable spending cap; use provider-side spending controls for a hard limit and a shared persistent limiter before scaling to multiple instances.
- The backend sends `PokeSift/0.1` as its application identifier; Python's default user agent was rejected with a non-JSON Cloudflare error.

Each photo may consume a scan, including timeouts. Never automatically retry. Prices are catalog references, not an appraisal of the physical card's condition, grade, or authenticity. Missing currency and condition remain explicitly unspecified.

## Development

Python 3.12+ with the pinned `qrcode` dependency (`pip install -r requirements.txt`). Node.js checks JavaScript. Inject `TCGAPI_KEY` and a separate `POKESIFT_PASSWORD` securely in the process environment, then run:

```sh
python3 server.py
```

Use `server.py`, not a static file server. Local mode binds only to loopback; public mode uses Render's `RENDER_EXTERNAL_URL` (or an exact HTTPS `PUBLIC_ORIGIN`, without a trailing slash) and must run behind an HTTPS reverse proxy. The browser submits to `/api/identify` on the same origin. No shared secret is baked into browser assets.

```sh
python3 -m unittest discover -s tests -v
node --check dist/app.js
```

Automated tests use fake secrets and simulated provider responses and consume no scans. A separate real mobile-browser test confirmed the environment-key flow identified Koraidon ex 254/198 while sending no API key in the browser request. Do not commit photos, credentials, or provider responses.

## Collection flow

Open **Add cards**, allow camera access, and capture repeatedly, or choose several photos. Images are prepared client-side (up to 2048 pixels), then identified with at most two concurrent requests. Results and estimated AUD values arrive in the camera tray without interrupting capture. Closing the camera stops its video tracks but leaves the scan queue running. There are no automatic scan retries.

The collection, capture thumbnails, catalog thumbnails and original provider results are saved under `pokesift.collection.v1` in this browser's localStorage. No collection is uploaded to a database or synchronized between devices. Clearing browser data removes it; use **Export collection** for a JSON backup. Interrupted scans are never resubmitted after reload. Storage errors remain visible and the in-memory collection can still be exported. Concurrent-tab edits do not silently overwrite each other.

For a confirmed match, the returned TCGPlayer ID fetches a canonical image from a fixed TCGPlayer CDN URL through an authenticated backend endpoint. It costs no identification scan. The app stores a compact copy locally and retains the capture thumbnail as a fallback; card details can switch between catalog and captured images. Uncertain candidates do not replace the user's photo.

## Currency and valuation provenance

The original `market_price` is never converted in storage. An explicit provider currency is preserved. When absent, the app records `currency: "USD"`, `provider_currency: null`, `currency_assumed: true`, and the source URL, with `currencyAssumed` also flagged on the collection entry. TCG API documents TCGPlayer as its pricing source; [TCGPlayer confirms its marketplace prices are USD](https://help.tcgplayer.com/hc/en-us/articles/23375212682519-How-to-Buy-Internationally-on-TCGplayer). Legacy entries receive the same explicit assumption metadata when loaded.

All headline valuations are calculated in AUD using [Frankfurter's public ECB-derived rates](https://frankfurter.dev/). `/api/exchange-rates` obtains AUD-based rates: `AUD amount = original amount / units of original currency per AUD`. The date and rate source remain visible. Rates are cached separately under `pokesift.fx.v1`; refreshed on page load, on return after six hours, and through the footer refresh button (server cache lifetime six hours). No stored quote is changed when exchange rates move. Cached fallback rates are labelled; if conversion is unavailable, the UI never relabels the source amount as AUD. These are reference conversions, not bank or exchange fees.

## Browser regression tests

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

Browser tests start a temporary authenticated local server and mock every identification and rate request. They cover rapid multi-upload, out-of-order responses, the two-request limit, camera capture/release, quiet price arrivals, canonical-image persistence, browsing/search/review filtering, reload interruption, storage failure, currency assumptions, explicit non-USD currencies, and AUD revaluation without mutating source quotes. They consume no real scans. GitHub Actions runs both these and the Python suite. For manual live verification, keep a strict scan budget and never retry a paid request automatically.

## Backups and future database migration

**Back up collection** downloads a versioned JSON backup containing all collection entries: stable entry IDs, capture timestamps, original identification results and candidates, original prices/currencies, assumption flags and provenance, capture thumbnails, canonical image data, scan outcomes/messages, plus the separately cached exchange rates. It contains no passwords, session cookies or invites. The original API responses and images can be migrated to a database without scanning again.

**Restore backup** accepts current versioned backups and the earlier `version: 1` collection exports. It validates images/result structures, merges by entry ID without replacing existing records, and skips duplicate IDs. Pending scans become interrupted records and are never resubmitted. Import makes no identification or catalog-image requests. Imports are limited to 250 MB/1,000 entries; localStorage quota failures remain visible and imported data can be exported from memory before leaving. Keep the original backup until you confirm the restore. Local collections are not encrypted against another person using the same browser profile.


## Unsupported printings and future providers

TCG API currently documents English printings and Japanese Pokémon support. A language outside its catalog is not a failed collection entry: the app displays the name, number, set, finish and language clues read from the photo and explicitly shows **Value unknown**. Unconfirmed candidates never supply a displayed valuation or a canonical image. Existing saved responses gain this display without rescanning. Unknown does not mean a value of zero.

New scans retain the exact prepared upload (up to 2048 pixels / 8 MB) in device-local IndexedDB `pokesift-media`, alongside localStorage metadata and thumbnails. `scanPhoto` records its key, MIME type, size and persistence outcome. Storage failures retain the blob in memory, show a warning and prompt before leaving; back up before closing the page. Older entries only have their previously retained images. Their original resolution cannot be recovered retroactively.

`providerObservations` retains the raw, server-redacted identification response before display normalization, the provider, operation, request parameters and response timestamp. Older entries are explicitly labelled `previously_saved_result`. These observations and printed identifiers can be reused for future catalog queries. If another vision service needs a photo, it can reuse the archived upload after the user authorizes any paid processing. The secondary catalog lookup below reuses those details without resubmitting photos.

Backup version 2 includes **both** browser stores: all metadata, provider observations, scan images, thumbnails, catalog images, pricing/currency provenance and the rate cache. The `missingScanImages` list identifies any expected photos that could not be recovered. Restore supports version 1 and 2, can fill missing scan images for duplicate entry IDs, and performs no API identification requests. A database migration can consume this evidence without asking users to photograph their cards again, subject to the retained evidence's quality.

Provider research: TCGdex offers free multilingual metadata, including Chinese set lists, but the tested Simplified Chinese set `CS1aC` returned no card records, and `CSWhSC` was not present in either Chinese set list. Subsequent PikaQian research found the matching Delibird `011/058` under `CSVH5C`; the earlier `CSWhSC` was likely an OCR error. Its exact catalog image exists, but no recorded price was observed. Scrydex documents a separate Vision API (5 credits/request plus API key and team ID); it has not been connected or tested here. Another language's artwork/price is never silently substituted for the actual printing.

## Collection valuation choice

Matched cards show the lowest positive available quote directly in the collection, camera result tray and incoming-result banner, labelled “Lowest estimate” when multiple quotes exist. Different currencies are compared in AUD; if required exchange rates are missing, the app does not guess which is lower. Missing/zero placeholder quotes are excluded. Unconfirmed card candidates still show an unknown value.

The card detail selector lets the user choose a printing/condition quote or return to automatic lowest-value selection. `selectedPriceKey` stores the quote's printing, condition, currency and source identity separately from provider observations, so changing price amounts or quote ordering does not change the selection. Local storage and backups preserve the choice. Original quotes and provider evidence remain unchanged.

## PikaQian secondary catalog and pricing

Set `PIKAQIAN_API_KEY` on the backend (Render Environment). The key is never sent to browsers, images, URLs or logs. New unsupported/not-found/ambiguous Pokémon scans with a readable name and collector number automatically query the Chinese catalog without sending another photo. Existing saved entries have **Check Chinese catalog** in their details; confirmed PikaQian entries have **Refresh Chinese card details**. Reloading or importing does not replay lookups.

Name and number must agree. Exact set, known printed total and finish/stamp agreement can confirm a unique match; uncertain OCR corrections, unknown totals, unknown finishes and partial searches require the user's confirmation. Candidate previews are labelled as possible printings and become the saved canonical image only after confirmation. The original TCG response remains untouched; the separate `catalogMatch`, observations, source IDs and explicit confirmation are saved and backed up. No Japanese or English quote is substituted for the Chinese printing.

PikaQian's public website and API have different pricing access. The API **requires Hobby or above for raw prices**. A Free key returns `403 tier_required` from `/prices`, even for cards priced on its website. The app distinguishes this from `404 price_not_found` or an empty raw-grade price. An account upgrade uses the same key; pricing access is rechecked after a short (60-second) denial cache. It does not require another scan. No subscription upgrade is made by the app.

`PriceSummary.grades.raw.price_cents` is stored as original integer **USD cents**, alongside the derived USD major-unit quote used by the existing AUD display. Original price summaries, source, date and sales-count metadata are retained. Graded buckets never value a raw card. The pricing-enabled parser is covered by schema-based fixtures; the live key was Free during initial verification, so a live paid-price response remains to be verified after upgrade.

Catalog API requests use fixed hosts, bounded responses, no redirects, a five-minute/250-entry cache, and a process-local limit of 60 upstream attempts/hour (not a durable monthly spending cap). Searches read at most 100 records and three candidate details; incomplete results are never auto-confirmed. Images are fetched only from the provider's fixed CDN and card-ID path, with no API credentials. Every displayed PikaQian card has a visible source link. Free-tier variant coverage is limited; a missing reverse variant must not be replaced silently with its base printing.

References: [API pricing schema](https://pikaqian.com/docs/api/get-card-prices-v-1-cards-card-id-prices-get/), [plans](https://pikaqian.com/docs/tiers-and-rate-limits/), [terms](https://pikaqian.com/terms). PikaQian's raw-data redistribution and post-downgrade retention restrictions still apply; private collection backup permission has not been separately confirmed with the provider. The app preserves the user's combined collection backup and does not offer a public bulk catalog export.

## Bulk missing-price updates

**Update missing prices** appears above the collection for confirmed PikaQian printings. It calls the authenticated, same-origin `POST /api/pikaqian-prices` endpoint with the saved provider card ID. Each uncached lookup makes just one upstream `/cards/{id}/prices` request; no recognition, catalog search, set lookup or image request is made. Duplicate copies share the lookup. Cards already holding a positive quote and unconfirmed matches are skipped.

Each user-started run handles at most 25 distinct printings, one at a time, with a two-second pause between calls. There are no automatic retries. Access/plan/configuration failures, rate limits, provider circuit-breaker errors and timeouts stop the run immediately. Other failures stop it after three consecutive errors or five errors in total. A healthy no-sales response counts as a completed lookup and is recorded with `priceCheck`; the same printing is skipped for 24 hours across reloads and backups. Existing prices are never cleared by a failed request.

Progress and stop controls are inline. Stop allows the in-flight request to finish and save, then sends nothing more. Hiding the page, signing out or another tab modifying the collection also stops further work. Results save after each lookup; a storage failure stops the run. Reload never resumes a batch. Price observations, original USD cents, source dates and confirmation choices stay in local storage/backups; prices display in AUD.

Server protections are shared by all devices within the running process: the existing 60-upstream-attempts/hour limit, five-minute cached prices/no-sales results, a five-minute circuit pause after three provider failures or a malformed price summary, and five-minute pauses for invalid credentials or quota rejection. Plan denial is cached for 60 seconds. These controls reset on service restart and are not a durable monthly allowance cap. PikaQian's own account quota remains authoritative.
