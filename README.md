# PokéSift

A password-protected, mobile-friendly test page for identifying one photographed Pokémon card and inspecting catalog prices through TCG API.

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
- No application request logging, analytics, key/photo persistence, or browser storage. Hosting/provider policies and browser credential caching are separate. Keep platform request-body/header logging disabled.
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
