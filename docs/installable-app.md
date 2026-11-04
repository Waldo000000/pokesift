# Install PokéSift

PokéSift can be installed from https://pokesift-dev.onrender.com as a web app
on Android and iPad. It has its own launcher icon and app window. No app-store
account, download package or subscription is required.

- **Android / Chrome:** open PokéSift, then Collection tools (•••) → Install
  PokéSift. When the browser offers installation, tap Install. The Chrome menu
  also has Install app / Add to Home screen. Browser engagement rules may delay
  the in-app install prompt; the manual instructions stay available.
- **iPad / Safari:** open PokéSift, tap Share → Add to Home Screen. This may
  be under More / View More. Enable Open as Web App if shown, then Add.
- A quiet Install PokéSift link is also available on the sign-in screen.

Open the new icon and sign in with the same Google account to sync the same
collection. A newly installed app may ask you to sign in again. With legacy
device-only mode, pair the app with a device invite and use a backup to move
cards from the original browser. Installation does not import, delete or
rescan a collection. Scanning and syncing need an internet connection.

## Implementation and updates

`dist/manifest.webmanifest` uses a stable root identity and start URL, root
scope, standalone display and unrestricted orientation. Both portrait and
landscape remain available. Icons include 192/512-pixel PNGs, a maskable
512-pixel PNG and an opaque 180-pixel Apple touch icon. Rebuild the original
brand mark with `python scripts/build_app_icons.py`; no image library is needed.

`pwa.js` registers the worker without reloading the collection. It waits for
an explicit tap before invoking a browser install prompt; dismissal leaves
the app usable. iPad instructions support the desktop user agent with touch
input. Already installed windows show installation status rather than another
prompt. Sign-in, camera, uploads and account APIs use their existing flows.

`sw.js` only caches `/offline.html`, `/offline.js`, `/pwa.css`, and the public
192-pixel icon. Home-page navigations use the network and show connection help
on a network failure. API calls, runtime configuration, OAuth callbacks,
invitations, app documents, collection data and photos are never placed in
Cache Storage. Query/fragment-bearing navigation URLs are not used as cache
keys. The worker does not intercept POST requests or replay scans.

New workers wait for existing app windows to close instead of forcing an
activation or reload during a scan. When changing the cached connection-help
files, bump the cache version in `sw.js`. Activation only removes obsolete
`pokesift-install-*` caches, never collection databases or photo storage.

The server exposes only the named public installation files. CSP permits
same-origin manifests, workers and icons; external sources and inline script
remain blocked. The worker is served with `no-store`, root scope and JavaScript
content type. No account/security settings or provider configuration change.

`npm run test:install` checks real Chromium installability, prompt states,
offline launch/recovery, cache exclusions and preserved collection/photo data,
plus iPad installation guidance and standalone sign-in/camera behavior in
WebKit. CI installs both engines. On a local machine without WebKit libraries,
`POKESIFT_CHROMIUM_ONLY=1 npm run test:install` runs iPad UI emulation in Chromium;
that is not a substitute for WebKit or installing on physical hardware.

Platform references:

- https://web.dev/articles/install-criteria
- https://support.apple.com/guide/ipad/ipad8f1f7a29/ipados
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
