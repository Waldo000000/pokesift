# PokéSift

A mobile-friendly page for identifying one photographed Pokémon card and inspecting its catalog prices using TCG API. No collection/dashboard features.

## Live development deployment

[Deploy to Render](https://render.com/deploy?repo=https://github.com/Waldo000000/pokesift)

Sign in to Render, connect this GitHub repository, and deploy its `render.yaml` Blueprint. It requests a **free** Python web service, runs tests during builds, and automatically redeploys commits to `main`. Open the HTTPS service URL Render assigns on your phone. Free services can sleep when idle, so the initial page load may take time. Deployment is not complete until the service reports live and its URL has been checked.

The page is publicly accessible; every tester supplies their own TCG API key. No shared API key is configured on the server. Enter your key, select your card photo, and press **Identify card + get prices** once. Each submission can consume a scan. A timeout may also consume a scan; check your provider dashboard before retrying. There are no automatic retries.

Render supplies `PORT` and `RENDER_EXTERNAL_URL`. The server uses the exact external origin to validate Host and browser Origin headers; it does not trust arbitrary forwarded host headers. To deploy elsewhere, set `PUBLIC_ORIGIN` to the exact HTTPS origin (no trailing slash) behind a TLS-terminating reverse proxy. The service binds publicly only when an external origin is configured. The health endpoint is `/healthz`. The small development server bounds concurrent requests to eight; this is not intended for high-traffic production use.

The historical `.openai/hosting.json` remains a record of an earlier, unpublished static Site. It is not used by this deployment. Serving only `dist/` will not work: the page needs the backend.

## Privacy and pricing

The key and photo pass through the backend in memory to `api.tcgapi.dev`. The app does not save them, uses no analytics or browser storage, disables request logging, and redacts key echoes in provider responses. Hosting platform metadata/access logs and the provider's own data policies are separate. No API key belongs in GitHub, environment setup, chat, or deployment configuration.

The backend is necessary because an OPTIONS request from the intended separate website origin returned `Access-Control-Allow-Origin: https://tcgapi.dev`; direct cross-origin browser requests would fail. It forwards only to the fixed identification endpoint with `game=pokemon&include=prices`.

Prices are catalog references, not appraisals of the photographed card's authenticity, grade, or condition. The page displays printing, source, currency and available timestamps. The initial expected visual reading is Koraidon ex, SVI 254/198; this is a manual observation, not an API result. Automated checks use simulated results and consume no scans.

## Local development

Requires Python 3.12+ and Node.js for JavaScript checks. No third-party runtime dependencies.

```sh
python3 server.py
```

Run checks:

```sh
python3 -m unittest discover -s tests -v
node --check dist/app.js
```

GitHub Actions runs these checks on pushes and pull requests. Use `server.py` instead of a static HTTP server, because the page submits to `/api/identify` on the same origin. Do not commit API keys, uploaded photos or provider responses.
