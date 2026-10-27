# PokéSift

A camera-first Pokémon collection app: scan cards in succession, watch their values arrive, then browse your collection. Supports Chinese printing lookups, canonical card images, AUD valuations and complete browser-local backups.

**Development app:** https://pokesift-dev.onrender.com/ — access requires a short-lived pairing invite from an existing device or the server administrator.

## Using the app

1. Scan a pairing QR to remember your device for 30 days. A paired device can use **Add another device** to create another ten-minute invite.
2. Open **Add cards** and take photos repeatedly, or select several existing photos. Up to two scans run concurrently; results and values appear in the camera tray without interrupting capture.
3. Close the camera and choose **All cards**, **Binder**, **Fan** or **Pokémon Zoo** to browse your saved collection. Closing the camera stops video capture but lets queued scans finish; keep the page open until they complete.
4. Review uncertain Chinese printing matches and confirm the correct card. Unsupported or unpriced cards stay in the collection with **Value unknown** and the identification details available so far.
5. For **Retake suggested**, choose **Retake photo** on the collection card or in its details. The next capture updates that entry; opening or cancelling the camera uses no scan. Submitting a new photo uses one scan. Previous captures and provider responses remain in the backup.
6. Use **Back up collection** regularly. Collections belong to this browser; pairing another device does not synchronize them.

Matched cards show a value directly in the collection and camera tray. Where multiple positive quotes exist, the default is the lowest estimate. The card detail selector lets you choose a particular printing/condition quote instead; that choice survives price changes, reloads and backups. Unconfirmed candidates never supply a valuation. Prices are catalog references, not an assessment of the physical card's condition, grade or authenticity.

Live camera captures use a portrait frame with the proportions of a Pokémon card (63:88), including on landscape laptop webcams. Only the area shown in that preview is uploaded. Keep all four card edges inside the guides and use **＋ / −** to adjust framing from 1× to 3× before capturing. This is a digital crop; moving the card closer still helps retain readable detail. Framing adjustments use no API requests. Imported photos retain their original framing.

**Flash on/off** appears in the live preview when the active camera and browser expose camera-light control. It uses the continuous light (torch), so you can check reflections while framing and keep it on for successive photos. Closing the camera stops the track and turns its light off; reopening starts a fresh camera session. Cameras or browsers without this capability keep the usual capture controls.

Camera uploads retain their source dimensions, crop rectangle and zoom in the collection and backups. The archived scan image is the exact cropped upload; the full surrounding webcam frame is not retained.

## Browsing your collection

The home-page tabs use your actual saved cards, images and AUD valuations:

- **Binder:** a physical simulation with at least 20 pages and two stacks. New cards join stack one. Drag cards out of sleeves in any direction, drop them in empty pockets or on either stack, and turn pages with a short horizontal or diagonal tug from a corner or an empty pocket. Occupied pockets cannot be swapped. Landscape tablets show a two-page spread. Tap a card for placement actions and full details.
- **Fan:** sift through overlapping cards, filter by Pokémon species type, search and sort. Changing the filter, search or sort starts on the rightmost card. Sort priority runs from right to left, so the highest value, first name or newest card is on top. Background valuation updates retain the selected card. A quick flick, including a swipe across the phone screen, moves directly to the next revealed card, keeping the fan open throughout. A long flick previews at most one card; pausing into a hold continues smoothly from that position. Holding and dragging follows the latest pointer position on each animation frame, with quick settling and revealing; the opening stays anchored while it closes. Cards stay overlapped while held, settle without a spring bounce, then reveal the selected card after release. Tap the selected card to review its original valuation choices and details.
- **Pokémon Zoo:** one character per identified species, with evolutions initially grouped together. Drag characters to arrange them; tap to open a fan of your copies and variants. **Share picture** uses mobile sharing when available, otherwise downloads a PNG.

Binder placements and Zoo positions save with the collection and travel in backups. Browsing does not spend identification or pricing credits. The Zoo uses a bundled multilingual index of 1,025 Pokémon species, plus public [PokéAPI artwork](https://github.com/PokeAPI/sprites) fetched through an authenticated, cached endpoint. No new API key is needed. It groups species, not every regional form or artwork variation. The **Pokémon in this card** section in card details lets you correct a detected species, assign multiple species, or exclude a trainer/energy card. Unidentified cards remain available in the Binder and Fan.

The home page also links to the separate sample-card [Binder](https://pokesift-dev.onrender.com/concepts/binder.html), [Fan](https://pokesift-dev.onrender.com/concepts/desk.html) and [Zoo](https://pokesift-dev.onrender.com/concepts/zoo.html) prototypes. Their demo arrangements are isolated from your collection.

## Identification, images and prices

| Service | Role | Configuration and coverage |
| --- | --- | --- |
| [TCG API](https://api.tcgapi.dev/) | Primary photo identification and prices | `TCGAPI_KEY`; its catalog documents English printings and Japanese Pokémon support. |
| [PikaQian](https://pikaqian.com/docs/) | Secondary Chinese catalog, canonical images and raw-card prices | `PIKAQIAN_API_KEY`; Free provides catalog access, while raw prices require Hobby or above. Variant coverage also depends on the plan. |
| [Frankfurter](https://frankfurter.dev/) | Public ECB-derived exchange rates for AUD display | No API key. Rates are cached for six hours. |

Buy more primary identification scans in the [TCG API dashboard](https://tcgapi.dev/dashboard/) under **Billing**; see their [scan-pack pricing](https://tcgapi.dev/pricing/).

New unsupported, not-found or ambiguous Pokémon scans with a readable name and collector number automatically try PikaQian. This sends saved identification details, not another photo. Existing entries offer **Check Chinese catalog**; confirmed PikaQian entries offer **Refresh Chinese card details**. Reloading or restoring a backup never repeats a lookup automatically.

PikaQian matches require name and number agreement. A unique match can be confirmed automatically when set, printed total and finish/stamp agree. OCR corrections, missing details or incomplete searches require user confirmation. Another language's printing or a base card's price is never silently substituted for the actual Chinese variant.

Confirmed cards save a compact canonical image from TCGPlayer or PikaQian alongside the capture thumbnail. Unconfirmed candidates can have labelled previews but do not replace the saved card image. Catalog image retrieval consumes no TCG identification scan. PikaQian cards include a source link.

### Pricing access and currency

A price visible on PikaQian's public website does **not** imply that a Free API key can retrieve it. The app distinguishes a pricing-plan restriction from a card with no recorded raw-card price. After upgrading the account, the same key can fetch missing prices without rescanning; a plan denial is cached for 60 seconds. The app never upgrades subscriptions itself.

Original provider prices and currencies are retained, while headline values are displayed in **AUD**:

- TCG quotes without a currency are assumed to be USD, based on [TCGPlayer's documented marketplace currency](https://help.tcgplayer.com/hc/en-us/articles/23375212682519-How-to-Buy-Internationally-on-TCGplayer). Each assumption records the missing provider currency, an assumption flag and its source. Explicit currencies are preserved.
- PikaQian's `PriceSummary.grades.raw.price_cents` is retained as integer USD cents, with a derived USD quote for conversion. Graded-price buckets never value an ungraded card. Provider observations preserve pricing provenance, dates and sales metadata.
- AUD amounts are calculated using Frankfurter's AUD-based rates: `source amount / source-currency units per AUD`. Changing exchange rates changes the display, not the stored quote. The rate date and source are visible; cached fallback rates are labelled.

Rates refresh on page load, on return after six hours, or through the footer refresh button. If conversion is unavailable, the app shows **AUD unavailable**. It does not guess which quote is lowest across currencies without the necessary rates. An unknown price is never treated as zero.

### Updating missing prices

**Update missing prices** appears above the collection, with an explanation when no cards are eligible. It covers both confirmed PikaQian cards and older unsupported, not-found or ambiguous scans that saved a Pokémon name and collector number. No photo is resubmitted.

Confirmed cards use their saved provider IDs for a direct price lookup. Older unrecognized cards first search the Chinese catalog using their saved details; this can involve several catalog requests and a canonical image download. Exact matches can be priced immediately. Uncertain matches stay in **To review** for confirmation; their candidates are not treated as the user’s card. Cards without enough saved identification data cannot be looked up automatically.

Duplicate provider IDs or identical saved lookup details share a request. Positive quotes and candidates already awaiting confirmation are skipped. Pricing-access failures preserve any newly found card details before stopping the batch.

| Safeguard | Behaviour |
| --- | --- |
| Batch size and pacing | At most 25 distinct saved lookups per run, sequentially, with a two-second pause between lookups. |
| Retries | None. Reload never resumes a batch. |
| Immediate stops | Access, plan, configuration or rate-limit errors; an open provider circuit; or a request timeout. |
| Other errors | Stop after three consecutive failures or five failures in total. |
| No recorded sales or catalog match | Save the result and skip the same lookup for 24 hours, including duplicate copies and after reload/restore. |
| User control | Inline progress and **Stop update**; the current request can finish and save, then no further calls begin. |
| Interrupted use | Hiding the page, signing out, another tab changing the collection, or a storage failure stops further work. |

Each completed lookup saves immediately. Failed requests do not clear existing prices. Server-side caches, request budgets and failure pauses are shared across devices within the running process; see [Security and operational limits](#security-and-operational-limits).

## Storage, backups and future migration

There is no collection database or cloud synchronization. Data stays in the current browser:

| Browser store | Contents |
| --- | --- |
| localStorage `pokesift.collection.v1` | Entries, stable IDs, timestamps, capture thumbnails, canonical images, identification results, provider observations, confirmed catalog matches, original prices/currencies, valuation selections, price-check outcomes, manual species assignments, binder placements and Zoo positions. |
| IndexedDB `pokesift-media`, store `scan-images` | The exact prepared image uploaded for each new scan, up to 2048 pixels / 8 MB. This is not the original full-resolution camera file. |
| localStorage `pokesift.fx.v1` | Cached exchange rates and their provenance. |

**Back up collection** downloads a version 4 JSON backup combining both storage systems and the rate cache. It includes Binder/Zoo arrangements, species assignments, current and previous retake images, capture history, and a `missingScanImages` list for any expected images that could not be recovered. Passwords, session cookies and invites are excluded.

**Restore backup** accepts version 1–4 backups, up to 250 MB / 1,000 entries. It merges by entry ID, skips existing card records and can fill missing archived images. Existing arrangements are preserved when merging; an empty collection restores the backed-up layout. Pending scans become interrupted records. Restore makes no identification or catalog-image requests. Keep the original file until the restored collection is verified.

Saved identifiers, raw server-redacted provider observations and archived uploads can support a future database migration or another provider without photographing cards again. Older entries only have the images retained when they were created; lost resolution cannot be recovered. A new paid processing operation would still consume that provider's allowance.

Browser storage has finite capacity. Failures remain visible, with unsaved data retained in memory for backup before leaving. Concurrent-tab edits are guarded against silent overwrites. Clearing browser data removes the collection; local records and backup files are not encrypted against someone with access to the browser profile or file.

## Deployment and device access

The app uses a Python server and static HTML/CSS/JavaScript, with no frontend build step. [`render.yaml`](render.yaml) defines the free Render service, health check, Python version, build command and automatic deployment from `main`. Connect the GitHub repository to Render and provide the server-side environment variables:

| Variable | Purpose |
| --- | --- |
| `TCGAPI_KEY` | Required primary provider key. |
| `POKESIFT_PASSWORD` | Required signing secret, at least 16 characters and different from the API key. Generate it with a password manager; users sign in through invites, not a password prompt. |
| `PIKAQIAN_API_KEY` | Enables Chinese catalog and pricing requests; optional for primary scanning. Pricing requires the appropriate provider plan. |
| `PUBLIC_ORIGIN` | Optional exact public HTTPS origin, without a path or trailing slash. Overrides `RENDER_EXTERNAL_URL`. |
| `RENDER_EXTERNAL_URL` | Public origin supplied automatically by Render. |
| `PORT` | Server port; defaults to `8000`. |

Save secrets in **Render → Service → Environment** and deploy. Cloud development secrets and Render secrets are separate. Never use frontend/public environment variables for provider keys. The app reads process environment variables; it does not load `.env` files automatically.

Use `server.py`, not a static file server. With a public origin configured, it binds to `0.0.0.0` and must run behind an HTTPS reverse proxy. Without one, it binds to loopback for local development. The public shell and `/healthz` remain available when configuration is missing, but protected data APIs fail closed. Free Render instances can sleep between requests.

### First device or recovery

With dependencies installed and the deployed `POKESIFT_PASSWORD` securely supplied in the process environment, generate an invite:

```sh
python3 scripts/create_invite.py \
  --origin https://pokesift-dev.onrender.com \
  --output /tmp/pokesift-invite.svg
```

Use a new output filename: the helper refuses to overwrite an existing file. Scan the SVG QR within ten minutes, then delete it. The QR is a temporary bearer credential; keep it private and out of Git. Never pass the signing secret as a command argument. Once paired, **Add another device** handles subsequent invites inside the app.

Invites are reusable for ten minutes and bound to the exact origin. The invite is carried in the URL fragment, removed immediately by the page, then exchanged through a same-origin POST. It is never stored in localStorage. Production sessions use a 30-day `__Host-` cookie with `Secure`, `HttpOnly` and `SameSite=Strict`.

Deployments preserve sessions when the signing secret and origin stay the same. Rotating `POKESIFT_PASSWORD` revokes all sessions and invites. Signing out clears this browser's cookie, not its collection or a copied session token. There is no individual-device revocation database.

## Local development and tests

Use Python 3.12 and Node.js 24 (the CI versions). Node is needed for checks and browser tests, not the running app. From the repository root, install dependencies in your preferred Python environment:

```sh
pip install -r requirements.txt
npm ci
npx playwright install --with-deps chromium
```

Supply `TCGAPI_KEY` and a separate `POKESIFT_PASSWORD` in the process environment, then run:

```sh
python3 server.py
```

For local browser access, run this in another terminal with the same signing secret and open the printed temporary invite URL privately. It is valid only for the exact local origin below; adjust the port if necessary.

```sh
python3 - <<'PY'
import os
from auth import mint_token

origin = 'http://127.0.0.1:8000'
token = mint_token(os.environ['POKESIFT_PASSWORD'], 'invite', origin)
print(f'{origin}/#invite={token}')
PY
```

The SVG helper requires HTTPS; the local URL above is for loopback development. Use the deployed HTTPS app for phone camera testing. Real scans consume provider allowance, including some failed or timed-out requests; never retry automatically.

Run the automated checks without real provider credentials or scans:

```sh
python3 -m unittest discover -s tests -v
npm run check
npm run test:browser
npm run test:concepts
npm run test:collection
```

Tests use fake credentials and mocked upstream responses. The browser suite starts a temporary local server and covers capture queues, mobile layout, result arrivals, valuation choices, currencies, Chinese matching, bulk pricing, storage failures and backup/restore, older-card enrichment and retake history. Separate suites cover the physical prototypes and production collection views, species corrections, saved arrangements and complete backup/restore without paid requests. [GitHub Actions](.github/workflows/checks.yml) runs the Python, JavaScript syntax and browser checks.

PikaQian pricing is tested against schema-based fixtures. The live key was on Free during initial integration verification; a real pricing-enabled response still needs verification after an account upgrade.

### Code map

| Path | Responsibility |
| --- | --- |
| [`server.py`](server.py) | HTTP server, authenticated provider forwarding, images, rates and request limits. |
| [`auth.py`](auth.py) | Purpose-separated, origin-bound invite and session signatures. |
| [`pikaqian.py`](pikaqian.py) | Chinese catalog matching, pricing, cache and provider failure controls. |
| [`dist/`](dist/) | Browser UI, capture queue, valuations, collection and local media storage. |
| [`dist/collection-views.js`](dist/collection-views.js) | Collection/species mapping and persistence bridge to the isolated browsing frame. |
| [`dist/concepts/`](dist/concepts/) | Shared Binder, Fan and Zoo interactions, plus public sample pages. |
| [`pokemon_art.py`](pokemon_art.py) | Fixed-host public artwork retrieval with bounded cache and failure cooldown. |
| [`scripts/build_species_index.py`](scripts/build_species_index.py) | Regenerate the bundled multilingual species index from PokéAPI CSV data. |
| [`scripts/create_invite.py`](scripts/create_invite.py) | Bootstrap/recovery QR generation. |
| [`tests/`](tests/) | Python unit tests and Playwright browser regression suite. |

## Security and operational limits

Provider keys stay server-side. Protected endpoints require a signed device session; POSTs also require the correct origin. The backend validates the deployment host, uses fixed provider/CDN hosts, verifies TLS, bounds request/response sizes and follows no redirects or automatic retries. Provider key echoes are redacted before responses reach the browser. There are no application request logs or analytics; keep hosting request-body/header logging disabled too.

The backend does not persist collection photos or provider responses. TCG API receives the scan image; PikaQian receives identification metadata or saved provider IDs. Provider retention policies remain separate from the app's storage behaviour.

| Provider protection | Current limit per server process |
| --- | --- |
| TCG identification | Two attempts per rolling second per paired device, including failures; no hourly cap. Uploads up to 8 MB. The browser spaces starts by 550 ms and runs at most two concurrently. |
| PikaQian requests | 60 upstream attempts/hour, including failures; five-minute cache with up to 250 entries. Catalog searches inspect at most 100 records and three candidate details. |
| PikaQian provider failures | Five-minute pause after three failures, a malformed price summary, invalid credentials or quota rejection. Pricing-plan denial is cached for 60 seconds. |

These controls reset on restart and are independent across server instances. They are **not a durable monthly spending cap**. Provider account quotas remain authoritative; use provider-side spending controls and a shared persistent limiter before scaling.

PikaQian's [pricing schema](https://pikaqian.com/docs/api/get-card-prices-v-1-cards-card-id-prices-get/), [plans](https://pikaqian.com/docs/tiers-and-rate-limits/) and [terms](https://pikaqian.com/terms) govern pricing access, attribution, commercial use and data retention. Its raw-data redistribution and post-downgrade retention restrictions also matter for backups and future migration; permission for private complete backups has not been separately confirmed. The app exports the user's combined collection, not a public bulk catalog.

### Card finishes and light

Card details now support drag-to-tilt viewing in the collection and binder. Open
**Card finish & light** to choose a simulated finish, its foil area and the card
layout, or inspect the mask. Visual choices are saved per entry and included in
collection backups; they do not change identity or prices and use no scan credits.
The [card playground](https://pokesift-dev.onrender.com/concepts/card-study.html)
compares 20 treatments, including matte, classic holo, reverse, full-card sparkle,
textured, rainbow, gold, cracked ice, and Poké Ball / Master Ball patterns.

Automatic coverage is deliberately conservative. Only two printing-specific
silhouette masks are currently supplied; other known whole-card finishes can use
a broad approximation, and uncertain finishes remain tilt-only until a visual
choice is made. See [finish research, coverage, exceptions and mask provenance](docs/card-finishes.md)
for the distinctions and the process for adding precise maps. Run `npm run test:foil`
for renderer, mask, persistence and no-credit browser checks.
