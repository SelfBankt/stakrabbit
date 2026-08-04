# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`index.html` is the entire project — a single self-contained static page for **stakrabbit**, a prototype local-gig-economy classifieds board ("Free Gig Market for local casual jobs": lawnmowing, dog walking, cleaning, etc.). There is no build step, no package manager, and no backend. All HTML, CSS, and JS live inline in this one file; the only external loads are Google Fonts, the `qrcodejs` and `leaflet` CDN bundles, and a handful of public APIs called at runtime (see below).

## Running it

Open `index.html` directly in a browser, or serve it so geolocation/fetch calls behave normally under `http(s)`:

```
python3 -m http.server 8000
```

There is no test suite or lint config.

## Architecture

Everything happens inside the single IIFE at the bottom of `index.html`. Key pieces:

- **Data model**: `listings` starts as `DEMO_LISTINGS` (hardcoded, `demo:true`) and gets live entries unshifted onto the front as they arrive. There is no persistence layer — anything posted locally lives only in that in-memory array and disappears on reload unless it also made it to Nostr relays.
- **Nostr integration is the actual backend.** Listings are [NIP-99](https://github.com/nostr-protocol/nips/blob/master/99.md) classified-listing events (`kind: 30402`), tagged `["t", "satrabbit"]` (see `FEED_TAG`) so the feed can filter to just this app's listings on shared public relays. `connectRelays()` opens WebSockets to the hardcoded `RELAYS` list and subscribes with a `REQ` for that tag; `eventToListing()` / `publishToNostr()` convert between the Nostr tag schema and the app's listing shape. A listing's `category` must match a slug in `CATEGORIES` for the `"t"` category tag to round-trip correctly.
- **Publishing requires a NIP-07 browser extension** (`window.nostr`, e.g. Alby). `checkSigner()` detects it and adjusts the post-form copy; without it, submitted jobs are added to the board locally only ("draft" — never broadcast).
- **Currency detection chain**: on load, IP geolocation via `ipapi.co` sets the display currency; browser geolocation or a manual location search (reverse-)geocoded via Nominatim (`nominatim.openstreetmap.org`) can override it. Country → currency mapping is the hardcoded `COUNTRY_CURRENCY` table; the GBP→target FX rate comes from `frankfurter.app`. All displayed prices are stored in GBP (`listing.price.gbp`) and converted for display only.
- **Distance sort** uses `haversineMiles()` against whichever `refCoords` was last set (browser geolocation or a search result); "Nearest" sort is disabled until a location reference exists.
- **Map view** is a Leaflet map (OSM tiles) built lazily on first switch to Map view (`initMap()`), centered on the Bristol area — this is a fixed default, not derived from user location.
- **Payment methods** are per-listing (`lightning` / `cash` / `bank`), each with its own panel in the pay drawer; the Lightning panel renders a `lightning:<address>` QR via `qrcodejs`. The app never collects or stores bank details — the footer/copy is explicit that those are exchanged directly between parties.

The footer labels this a "Prototype for pitch purposes" — demo listings are illustrative fixtures mixed in with anything live from relays, distinguished only by the `demo` flag / "Demo" badge.
