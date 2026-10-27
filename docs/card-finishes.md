# Card finishes and masks

Research checked 2026-10-27. This is a visual simulation, not a determination of a
physical card's finish, authenticity, condition or value. No scan or pricing API
is used to render or adjust it.

## Why pattern and area are separate

There is no single correct mask for “holo” or even “reverse holo”. Set, language,
printing and promotional variants matter. A flat catalog image does not reliably
identify where reflective material lies beneath the ink.

The renderer combines a procedural light response with an independent alpha
mask. The mask can cover the artwork background, entire artwork window, card body
outside the artwork, entire card, subject, border, or artwork plus border. Subject
and artwork-background masks require a printing-specific silhouette. Other areas
use explicitly selected layout templates and are approximations.

## Research and supported treatments

| Treatment | Typical coverage / important exceptions | Simulation |
| --- | --- | --- |
| Starlight (sometimes called galaxy) | Base, Jungle and Fossil illustration backgrounds | Stars that brighten with tilt |
| Cosmos | Base Set 2 onward through many older sets and promos; Delta Species can also foil the subject and border | Reflective circles and dots |
| Tinsel | Black & White-era artwork; Japanese printings can include the border | Horizontal stripes |
| Sheen | XY-era illustration; coverage and diagonal direction vary by language | Moving diagonal reflection |
| Line | Sword & Shield artwork; Japanese variants can include the border | Vertical refracting lines |
| Water web | Sun & Moon-era artwork | Wavy reflective lines |
| Reverse mirror | Usually body outside artwork; several EX-era exceptions below | Silvery reflection, no mandatory rainbow |
| All-over sparkle | Explicitly selected whole-card treatment | Stars over the whole card |
| Pixel / confetti | McDonald's and Celebrations examples; coverage is printing-dependent | Blocky foil pieces |
| Sequin | Some promotional cards | Small circles |
| Cracked ice | Theme decks and promos; some prints cover the body rather than the illustration | Reflective facets |
| Crosshatch / radiant grid | Promotional reverse patterns and selected modern special finishes; coverage differs | Intersecting diagonal lines |
| Etched full-art | Some full-art rare finishes | Fine curved lines; not the actual embossed contour map |
| Rainbow / gold | Selected special finishes | Broad colour treatment with simulated etching |
| Poké Ball / Master Ball | Certain regional/set reverse variants | Repeated ball motifs; chosen explicitly, never guessed from the Pokémon |
| Full-card sheen | Explicit whole-card foil metadata or user choice | Reflection over the full card |
| Fireworks | Legendary Collection reverse | Starburst approximation outside the artwork |
| Matte | Non-holo | Tilt and a mild surface reflection, no coloured foil |

Notable reverse exceptions documented by Bulbapedia:

- EX Hidden Legends and several following sets use symbols **inside** the artwork.
- EX Delta Species through some later EX sets can put reverse foil in the artwork
  background and apply additional foil to names, HP, symbols or borders.
- EX Dragon Frontiers can put reverse foil **on the Pokémon**.
- Ancient Trait cards can restrict reverse foil to the name area and lower card.
- Trainer, Energy, dual-type, Japanese, Chinese and promotional layouts cannot
  safely inherit one English Pokémon mask.

The engine supports these spatial categories, but does **not** claim an exhaustive
library of the individual masks needed for every such exception. Complex
multi-region prints need an additional reviewed registry entry. Do not label a
rectangular template as an exact mask.

Sources:

- [Bulbapedia: Holofoil, patterns, coverage and historical exceptions](https://bulbapedia.bulbagarden.net/wiki/Holofoil)
- [Bulbapedia: Pokémon ex](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_ex_(TCG)) and [rarity](https://bulbapedia.bulbagarden.net/wiki/Rarity): double-rare ex classification and artwork extending beyond the illustration window; the whole-card sparkle is a visual approximation, not an exact printing map.
- [Pokémon TCG API card object](https://docs.pokemontcg.io/api-reference/cards/card-object/): card IDs, sets, rarity, images and price variants; no per-pixel foil-mask field documented.
- [Simon Goellner's Pokémon Cards CSS project](https://github.com/simeydotme/pokemon-cards-css): reference for the feasibility of layered gradients, blending and transforms. Our renderer and generated textures are original; no source textures or code from that project are bundled.

## Automatic behaviour and provenance

`PokeSiftFoil.resolve` accepts saved identity, language, finish, canonical-image
availability and an optional user visual setting. It never uses the automatic
lowest price as evidence for finish. An explicitly selected price printing can
provide a finish label, but ambiguous labels still require an area selection.

- Explicit non-holo/normal: no coloured foil.
- English Base Set 2 Charizard 4/130 holo and Base Set Blastoise 2/102 holo:
  hand-traced, approximate artwork-background masks with Cosmos and Starlight
  respectively. Matching includes set, number, name and language; masks do not
  follow a species into a different printing.
- Explicit full-art/full-card foil, texture, rainbow, gold or sparkle metadata:
  a broad whole-card approximation, with its source explained in the UI.
- Saved `holo`, `holofoil`, `holo_foil`, `holographic` or `foil`: an approximate
  diagonal reflection over an artwork-window template (whole-card for Energy).
  Older recognized sets use the classic template; other Pokémon use modern, and
  Trainer cards use the Trainer template. Unknown/empty finish can fall back to
  the saved suggested printing. An explicit non-holo read still wins.
- Confirmed holo plus double-rare rarity, or a saved note explicitly identifying
  a double-rare Pokémon ex: whole-card sparkle with modern layout, labelled as an
  approximation. Sleeve notes alone do not enable foil. Rarity without a finish
  still does not enable it. Notes are local metadata and are never executed.
- Unrecognized finishes, unsupported games or original captures: tilt without
  coloured foil. Exact masks are never reused across mismatched languages or IDs;
  a known holo finish can instead use the generic, labelled approximation.
- A user's visual selection: marked as a user approximation, separate from all
  provider observations, identity, pricing and condition.

The saved entry field is deliberately small and versioned:

```json
{"visualFinish":{"version":1,"profile":"pokeball","region":"reverse","layout":"modern"}}
```

Only allowlisted profile, region and layout names are accepted. No imported CSS,
HTML, URLs or executable shader code is accepted. Existing backups export/import
the complete entry, including this field. Changing the appearance uses no credits.
Read-only collections and raw photo previews cannot save a visual correction.

## Adding a precise map

Add an exact printing-and-finish registry entry and its reviewed silhouette or
alpha geometry in `dist/card-effects.js`; never key a production mask only by a
Pokédex number. Include language, collector number and set, and extend the key
for promotional/stamped variants when adding them. The current two sample maps
are explicitly hand-drawn approximations, not verified physical maps. A later
segmentation service could propose silhouettes, but still needs finish coverage
validation before promoting them to automatic mappings.

The playground's **Explore foil finishes** and **Show foil area** controls compare
all patterns and regions on sample artwork. Choosing a different finish in the
playground is an experiment, not a claim that the sample was printed that way.

## Performance and accessibility

Textures are generated locally at a bounded resolution. They respond to tilt and
do not animate autonomously. Pointer capture supports touch and mouse; arrow keys
tilt and Home resets. Reduced Motion removes animated interpolation while keeping
direct manipulation. Closing details disposes the animation and event handlers.
