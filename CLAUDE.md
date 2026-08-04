# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`index.html` is the entire project — a single self-contained static page for **stakrabbit**, a decentralized local-gig-economy classifieds board built on the [Nostr](https://nostr.com/) protocol. There is no build step, no package manager, and no backend server; Nostr relays and a [Blossom](https://github.com/hzrd149/blossom) media server play that role instead. All HTML, CSS, and JS live inline in one file, structured as a single IIFE inside `<script type="module">`.

## Running it

No install step. Either open `index.html` directly, or serve it so geolocation/fetch calls behave normally under `http://`:

```
python3 -m http.server 8000
```

There is no test suite or lint config.

## Architecture

### Identity and auth

There are no accounts — identity is a Nostr keypair. Three ways to log in, all converging on a `currentUser = { method: "nip07"|"local", pubkey, npub, secretKey? }`:

- **Browser extension** (NIP-07, e.g. Alby) — signing delegates to `window.nostr`.
- **Generate a new key** or **import an existing nsec/hex key** in-browser via `nostr-tools` (loaded from esm.sh as ES modules — this is the only non-trivial external dependency).
- Locally-held keys can optionally be **encrypted at rest** with a passphrase (PBKDF2 → AES-GCM via Web Crypto). An encrypted session restores as `lockedAccount` on page load and requires unlocking before `currentUser` is set — see `loadSession()` / `openUnlockPrompt()`.

All event signing funnels through `signNostrEvent()` (signs only) and `signAndPublish()` (signs + broadcasts to relays + waits for a relay `OK`).

### Listings are Nostr events, not database rows

Listings are [NIP-99](https://github.com/nostr-protocol/nips/blob/master/99.md) classified-listing events (`kind: 30402`), tagged `["t", "satrabbit"]` (`FEED_TAG`) so the feed can filter to just this app's listings on the shared public relays in `RELAYS`. `buildListingTags()` / `eventToListing()` convert between the app's listing shape and the Nostr tag schema.

**Gotcha:** kind 30402 is an *addressable* (replaceable) event — relays key it by `(pubkey, kind, d-tag)`, not by event ID, and each edit or close republishes a brand-new event ID under the same `d` tag. `eventToListing()` therefore builds the listing's internal `id` as `pubkey:d-tag`, never `evt.id` — using the raw event ID would make every edit look like a new listing to the app itself. Because relays may deliver an older and newer version of the same listing in either order on a fresh connection, `listingLastSeenAt` tracks the latest `created_at` seen per id (independent of whether that listing is currently in `listings`) so a late-arriving stale "active" event can't resurrect a listing that was just closed.

Closing a listing (`handleCloseListing()` / `closeListing()`) republishes with `status: "inactive"` rather than deleting anything — the listing stays in the in-memory `listings` array (so My Jobs can still show it as Closed) and is only hidden from the public board by the status filter in `computeVisibleItems()`.

### Applying = an encrypted DM, not a database write

"Apply" sends a NIP-04 encrypted direct message (`kind: 4`) to the poster's pubkey via `sendApplication()` / `sendEncryptedDM()`, tagged with the listing's `id` so replies can be threaded. There is no reply/inbox concept on the relay side — `handleIncomingDM()` decrypts every kind-4 DM addressed to `currentUser.pubkey` and correlates it to a listing/application locally by that tag.

**Your own sent applications and replies are never fetched back from relays** — they're recorded locally in `myApplications` (persisted to `localStorage` per-pubkey via `saveMyApplications()`) at the moment they're sent. This means an application's outbound message history does not sync across browsers/devices, even though the underlying DMs are real Nostr events.

### Media attachments

Photos/audio/video attach via [NIP-92](https://github.com/nostr-protocol/nips/blob/master/92.md) `imeta` tags pointing at files uploaded to a Blossom server (`BLOSSOM_SERVER`, currently `blossom.band`). Blossom upload requires a signed authorization token (`kind: 24242`, per [BUD-11](https://github.com/hzrd149/blossom/blob/master/buds/11.md)) built by `createBlossomAuthToken()` — this token is signed but **never published to a relay**, it's sent only as an HTTP `Authorization` header on the upload request itself.

### Confirming publishes actually landed

`signAndPublish()` doesn't just fire-and-forget an `EVENT` message — it waits for at least one relay's `["OK", eventId, true, ...]` response (`waitForPublishConfirmation()` / `handlePublishAck()`) before resolving, and throws if every relay rejects or none respond within 5s. Without this, a relay silently dropping an event would look identical to success.

### Rendering

No framework — every `render*()` function rebuilds the relevant DOM subtree via `innerHTML` and re-attaches listeners. A few things worth knowing before touching this:

- `renderGrid()` and the My Jobs list renderers precompute lookup maps (e.g. pubkey → listing count, listingId → messages) in one pass before their `.map()` calls rather than re-filtering the full array per row — do the same for any new per-row derived data, or it silently becomes O(n²) as the relay feed grows.
- Rendering the Inbox/My Jobs drawers is skipped when they're not the currently-open drawer (checked via `.classList.contains("show")`) — background relay events (a new listing from anyone, or an incoming DM) would otherwise rebuild that HTML on every single event even while invisible. Their "open" click handlers already render fresh content at open time, so this only defers work, it never causes stale content.
- Drawers share `openDrawer()`/`closeDrawers()`, which also handle focus management (focus moves into the drawer on open, returns to the trigger element on close) and Escape-to-close.
- Leaflet (map view) is not loaded until the user first switches to Map view (`loadLeaflet()`) — it used to be a render-blocking `<script>` in `<head>` loaded on every visit regardless of whether Map view was ever used.

### Currency and location

Prices are stored in GBP (`listing.price.gbp`) and converted for display only. On load, IP geolocation via `ipapi.co` sets the display currency; browser geolocation or a manual location search (reverse-)geocoded via Nominatim (`nominatim.openstreetmap.org`) can override it. Country → currency mapping is the hardcoded `COUNTRY_CURRENCY` table; the GBP→target FX rate comes from `frankfurter.app`. "Nearest" sort is disabled until a location reference (`refCoords`) exists.

## Known limitations

- Applications/message threads are local-only (see above) — no cross-device sync.
- DMs use NIP-04, which encrypts content but not metadata (relays can see who's messaging whom, and when) — NIP-17 would close that gap but isn't implemented.
- No pagination — the relay subscription fetches up to 50 listings; older ones fall off.
