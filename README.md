# PokéSift

A password-protected, camera-first Pokémon collection app with background identification, canonical card images and AUD valuations.

## Render setup

In the `pokesift-dev` service's **Environment** settings, set these server-side secrets:

- `TCGAPI_KEY`: the TCG API key. Never use a frontend/public variable or put it in GitHub.
- `POKESIFT_PASSWORD`: a different password-manager-generated password, at least 16 characters. Do not reuse the API key.

Save the environment and deploy the latest `main` commit. Cloud task secrets are separate from Render secrets; configuring one does not configure the other. The app returns 503 until both secrets are configured. `/healthz` remains available for hosting health checks and reveals no configuration details.

Open the HTTPS service URL. At the browser's sign-in prompt use username **pokesift** and your `POKESIFT_PASSWORD`. Then select a photo and submit it once. No API key is entered or sent by the browser. HTTP Basic authentication is appropriate here for a single-owner development app behind Render's HTTPS endpoint; this is not a multi-user account system. The browser can remember login credentials. Rotate the password in Render and redeploy to revoke access.

`render.yaml` configures a free Python service and deployment on `main` commits. GitHub must be connected to Render for automatic deploys; otherwise use Manual Deploy. Free instances can sleep. The old `.openai/hosting.json` is historical and unused.

## Protections and limits

- All page assets and scanning requests require authentication. Only health checks are public.
- Missing/short passwords, identical API key and password, or a missing API key fail closed.
- Same-origin POST checks, exact deployment Host validation, no CORS grant, no automatic redirects or retries, and TLS verification for the fixed provider endpoint.
- API key comes only from the server environment; client `X-API-Key` headers cannot override it. Provider key echoes are redacted server-side, including JSON-escaped strings.
- No application request logging, analytics, or API keys in browser storage. Capture thumbnails, catalog images and card details are stored locally as part of the collection; full-resolution uploads are not retained by the backend. Hosting/provider policies and browser credential caching are separate. Keep platform request-body/header logging disabled.
- Images limited to 8 MB; response size capped; concurrent requests bounded. A shared budget permits at most 10 provider attempts per hour per process, including failures. This budget resets on restarts and is not a durable spending cap; use provider-side spending controls for a hard limit and a shared persistent limiter before scaling to multiple instances.
- The backend sends `PokeSift/0.1` as its application identifier; Python's default user agent was rejected with a non-JSON Cloudflare error.

Each photo may consume a scan, including timeouts. Never automatically retry. Prices are catalog references, not an appraisal of the physical card's condition, grade, or authenticity. Missing currency and condition remain explicitly unspecified.

## Development

Python 3.12+; no third-party runtime dependencies. Node.js checks JavaScript. Inject `TCGAPI_KEY` and a separate `POKESIFT_PASSWORD` securely in the process environment, then run:

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
