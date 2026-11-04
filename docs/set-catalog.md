# Sets catalog

Sets is a read-only English physical-card checklist, grouped by TCG series.
The reviewed index includes 205 sets/collections across 16 series and four
special-release groups. Pokémon TCG Pocket is excluded. Promos, Basic Energy,
trainer kits and other special releases are available under Other releases.

The index in `data/set-catalog-en.json` is a reviewed TCGdex snapshot dated
2026-11-04. `data/set-cards-en.json` contains 23 reviewed card lists (2,689
records). Other lists and individual card details load on demand from
`https://api.tcgdex.net/v2/en`. These are public, keyless reads. They do not
use recognition, pricing, or account scan allowances. No catalog reads write
to a collection or populate a missing card as owned.

Ownership requires a confirmed saved English Pokémon printing, an unambiguous
set identity, collector number and card name. Explicit TCGdex identities are
also supported. Duplicate copies count once toward completion, with a copy
selector in saved details. Finish variants share a checklist place. Unknown
languages, ambiguous matches and Chinese releases do not count as English.
The View set action in saved details opens its parent set, highlights the
matching card, and resets filters so it is visible. Catalog-only cards open
read-only details; saved cards open their existing details.

Subsets appear with their parent and can be filtered independently. Duplicate
entries sharing a provider artwork identity are shown once; their original
catalog identities remain available for ownership matching. Counts use the
actual displayed catalog records, not the printed main-set denominator or
every possible foil variant. The 30th Celebration list has 158 records plus
30 separate Classic Collection records, giving 188 checklist places.

TCGdex currently supplies no artwork for those 30 Classic Collection
records or the 25 Celebrations Classic Collection records. A placeholder is shown. Their local IDs are ordering positions and
are not assumed to be physical collector numbers; ownership needs an explicit
catalog identity there. No original-set image or printing is substituted.
Saved artwork is used for collected cards when catalog artwork is missing.

For six Sword & Shield subsets, 312 images were missing from the API
summaries but available at TCGdex’s documented parent-set asset paths. Every
low-resolution image was fetched over HTTPS and checked for a WebP signature
before its verified URL was added to the bundled list. Radiant Collection is
derived from the parent Legendary Treasures records, retaining the original
provider identities and artwork; it is not counted a second time.

`set_catalog.py` validates set membership before an upstream read, rejects
redirects and arbitrary URLs, limits response sizes, and accepts artwork only
from reviewed English `assets.tcgdex.net` paths. Authenticated API
routes are `/api/set-catalog`, `/api/set-card` and `/api/set-art`. Browser
images use same-origin fetches and bounded object-URL caching under the
existing CSP. Server image reads have three concurrent slots and a 24 MiB /
96-entry cache. Metadata has a 64-entry cache and failures have a cooldown.
Full-detail failures fall back to card summaries with a visible notice.

To update catalog coverage, review the public series/set metadata, preserve
physical/digital and language boundaries, validate subset relationships and
artwork identities, then update the two data files together. Do not copy
illustrative ownership from design prototypes. Run Python tests and
`npm run test:sets`; CI also runs the existing application regression suite.

Provider schemas: https://tcgdex.dev/reference/set,
https://tcgdex.dev/reference/card, https://tcgdex.dev/assets.
