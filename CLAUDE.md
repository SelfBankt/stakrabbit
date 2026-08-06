# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`index.html` is almost the entire project — a single self-contained static page for **stakrabbit**, a decentralized local-gig-economy classifieds board built on the [Nostr](https://nostr.com/) protocol. There is no build step, no package manager, and no backend server; Nostr relays and a [Blossom](https://github.com/hzrd149/blossom) media server play that role instead. All HTML, CSS, and JS live inline in one file, structured as a single IIFE inside `<script type="module">`. `manifest.json`, `sw.js`, and `icons/` are the only other files, added purely to make the page installable as a PWA — see "PWA" below.

## Running it

No install step. Either open `index.html` directly, or serve it so geolocation/fetch calls behave normally under `http://`:

```
python3 -m http.server 8000
```

There is no test suite or lint config.

## Architecture

### Identity and auth

There are no accounts — identity is a Nostr keypair. The login drawer's tab style (dark dotted-pattern header banner, equal-width underline tabs) and its N-Connect tab (QR code + Bunker URL sub-tabs) are modelled on [plebeian.market](https://plebeian.market)'s login dialog, adapted to this app's own stack and brand colours. Four ways to log in, in tab order **Create account, Extension, N-Connect, Private Key**, all converging on a `currentUser = { method: "nip07"|"local", pubkey, npub, secretKey?, viaBunker?, bunkerClientSecret?, bunkerPointer? }`:

- **Extension** (NIP-07, e.g. Alby) — signing delegates to `window.nostr`.
- **Create account** (generate a new key) or **Private Key** (import an existing nsec/hex key) in-browser via `nostr-tools` (loaded from esm.sh as ES modules).
- **N-Connect** (NIP-46 "bunker", e.g. [Amber](https://github.com/greenart7c3/Amber) on Android or nsec.app on any device) — see below.
- Locally-held keys can optionally be **encrypted at rest** with a passphrase (PBKDF2 → AES-GCM via Web Crypto). An encrypted session restores as `lockedAccount` on page load and requires unlocking before `currentUser` is set — see `loadSession()` / `openUnlockPrompt()`.

All event signing funnels through `signNostrEvent()` (signs only) and `signAndPublish()` (signs + broadcasts to relays + waits for a relay `OK`).

**N-Connect (NIP-46 remote signer):** built directly on nostr-tools' own `nip46` module (`BunkerSigner`, `parseBunkerInput`, `createNostrConnectURI` — loaded from esm.sh alongside the rest of nostr-tools, no separate signing library needed) rather than a third-party widget like nostr-login. Two sub-tabs mirror plebeian.market's structure:
- **QR Code** (`startNConnectQR()`): generates a fresh ephemeral keypair + `nostrconnect://` URI each time the tab is opened (rendered via the `qrcode` package from esm.sh), then calls `BunkerSigner.fromURI()` to listen on `RELAYS` for the signer to scan and approve. An `AbortController` (`nconnectAbortController`) tied to an incrementing `nconnectAttemptId` guard cancels/ignores a stale attempt when the user switches tabs or closes the drawer mid-wait — see `abortNConnectQR()`.
- **Bunker URL**: pastes a `bunker://…` string (or a NIP-05 identifier — `parseBunkerInput()` handles both), then `BunkerSigner.fromBunker()` + `.connect()`.

Either path ends in `finishNConnectLogin()`, which calls `installBunkerNip07()` — this wraps the live `BunkerSigner` in a small NIP-07-shaped adapter (`getPublicKey`/`signEvent`/`nip04.encrypt`/`nip04.decrypt`) and assigns it to `window.nostr` (stashing whatever was there before under `window.__stakrabbitOriginalNostr` first). This is the key simplification: because the bunker session *looks* like a NIP-07 extension afterwards, `signNostrEvent()`'s existing `"nip07"` branch — and `sendEncryptedDM()`/DM decryption/`createBlossomAuthToken()`, which all also just check `window.nostr` — need no bunker-specific code path at all. A bunker session is `{ method:"nip07", viaBunker:true, bunkerClientSecret, bunkerPointer, ... }`; `saveSession()`/`loadSession()` persist the ephemeral `bunkerClientSecret` and `bunkerPointer` (relays/pubkey/secret) so `reconnectBunkerSession()` can rebuild the same `BunkerSigner` on page reload without asking the user to scan/paste again, `.ping()`-ing it first to confirm the session's still live (falling back to `logOut()` if not). `logOut()` calls `uninstallBunkerNip07()`, which closes the signer and restores whatever `window.nostr` held before.

**Deliberately not using NIP-55 (Android intents):** Amber also supports a second, Android-native path — the `nostrsigner:` URL scheme, which jumps straight to the Amber app rather than requiring a pasted bunker string. The [NIP-55 spec itself warns against this for web apps](https://github.com/nostr-protocol/nips/blob/master/55.md): without NIP-46, "the web client can't call the signer in the background, so the user sees a popup for every request." Since nearly every action in this app signs an event (post, apply, rate, vouch, accept, DM reply, each media upload's Blossom auth token), that would mean an app-switch round trip on every single one, not just at login. NIP-46 (the N-Connect tab above) gives background signing after one connect, so that's the only path built here.

### Listings are Nostr events, not database rows

Listings are [NIP-99](https://github.com/nostr-protocol/nips/blob/master/99.md) classified-listing events (`kind: 30402`), tagged `["t", "satrabbit"]` (`FEED_TAG`) so the feed can filter to just this app's listings on the shared public relays in `RELAYS`. `buildListingTags()` / `eventToListing()` convert between the app's listing shape and the Nostr tag schema.

**Gotcha:** kind 30402 is an *addressable* (replaceable) event — relays key it by `(pubkey, kind, d-tag)`, not by event ID, and each edit or close republishes a brand-new event ID under the same `d` tag. `eventToListing()` therefore builds the listing's internal `id` as `pubkey:d-tag`, never `evt.id` — using the raw event ID would make every edit look like a new listing to the app itself. Because relays may deliver an older and newer version of the same listing in either order on a fresh connection, `listingLastSeenAt` tracks the latest `created_at` seen per id (independent of whether that listing is currently in `listings`) so a late-arriving stale "active" event can't resurrect a listing that was just closed.

Closing a listing (`handleCloseListing()` / `closeListing()`) republishes with `status: "inactive"` rather than deleting anything — the listing stays in the in-memory `listings` array (so My Jobs can still show it as Closed) and is only hidden from the public board by the status filter in `computeVisibleItems()`.

### Applying = an encrypted DM, not a database write

"Apply" sends a NIP-04 encrypted direct message (`kind: 4`) to the poster's pubkey via `sendApplication()` / `sendEncryptedDM()`, tagged with the listing's `id` so replies can be threaded. There is no reply/inbox concept on the relay side — `handleIncomingDM()` decrypts every kind-4 DM addressed to `currentUser.pubkey` and correlates it to a listing/application locally by that tag.

**Your own sent applications and replies are never fetched back from relays** — they're recorded locally in `myApplications` (persisted to `localStorage` per-pubkey via `saveMyApplications()`) at the moment they're sent. This means an application's outbound message history does not sync across browsers/devices, even though the underlying DMs are real Nostr events.

### Quote/bidding flow

An application is also a bid: `sendApplication()` embeds an `Offering: £N` line in the plain-text DM body alongside the free-text message — plain text, not a tag, so the application still reads fine as an ordinary DM in any Nostr client that doesn't know this convention. `handleIncomingDM()` extracts `offerGbp` from that line with a best-effort regex; an absent or unparseable offer just sorts last rather than breaking anything (see `sortApplications()`). This is what turns "apply at face value" into actual price discovery, per the guide's Airtasker comparison.

A listing gains a third status, `"in-progress"`, sitting between `"active"` and `"inactive"`: `handleAcceptApplicant()` (wired to each applicant's "Accept this offer" button in `renderJobDetailPostedView()`) republishes the listing with `status: "in-progress"` and a new `["accepted", pubkey]` tag, and DMs the accepted applicant. `isOpenListing()` hides both `"in-progress"` and `"inactive"` listings from the public board — once someone's hired, it shouldn't still look like an open opportunity. `openApplyDrawer()` also refuses to let anyone apply to a listing that isn't `"active"`.

Accepting is optional, not mandatory — a poster can still just close a listing without ever accepting anyone (older listings from before this feature, or a poster who just doesn't bother), so `listing.acceptedPubkey` may be null even on a closed listing. Reputation gating (see below) and `renderJobDetailAppliedView()`'s "you got this job" / "went to someone else" banners both fall back to their pre-Accept behavior in that case.

### Media attachments

Photos/audio/video attach via [NIP-92](https://github.com/nostr-protocol/nips/blob/master/92.md) `imeta` tags pointing at files uploaded to a Blossom server (`BLOSSOM_SERVER`, currently `blossom.band`). Blossom upload requires a signed authorization token (`kind: 24242`, per [BUD-11](https://github.com/hzrd149/blossom/blob/master/buds/11.md)) built by `createBlossomAuthToken()` — this token is signed but **never published to a relay**, it's sent only as an HTTP `Authorization` header on the upload request itself.

### Confirming publishes actually landed

`signAndPublish()` doesn't just fire-and-forget an `EVENT` message — it waits for at least one relay's `["OK", eventId, true, ...]` response (`waitForPublishConfirmation()` / `handlePublishAck()`) before resolving, and throws if every relay rejects or none respond within 5s. Without this, a relay silently dropping an event would look identical to success.

**Relay reconnection:** `connectRelay(url)` (called per-`RELAYS` entry by `connectRelays()`) auto-reconnects on any `close` — a relay dropping mid-session (laptop sleep, wifi blip, a relay restarting, a backgrounded mobile tab getting its sockets throttled) used to be permanent for the rest of that page load, since nothing ever retried; every later relay-dependent action would fail with "not connected to any relays" until a manual reload. `scheduleRelayReconnect()` backs off per-URL (`relayReconnectDelay`, 2s → doubling → capped at 20s, reset to the base on a successful `open`) so a relay that's down for a while isn't hammered. `signAndPublish()` also no longer fails instantly if zero sockets are open at that exact moment — `waitForAnyOpenSocket(4000)` gives a just-scheduled reconnect a few seconds to land first, since that race (action fired right as the last socket died, before its reconnect timer fires) was the most common way to hit the "not connected" error in practice.

### Rendering

No framework — every `render*()` function rebuilds the relevant DOM subtree via `innerHTML` and re-attaches listeners. A few things worth knowing before touching this:

- `renderGrid()` and the My Jobs list renderers precompute lookup maps (e.g. pubkey → listing count, listingId → messages) in one pass before their `.map()` calls rather than re-filtering the full array per row — do the same for any new per-row derived data, or it silently becomes O(n²) as the relay feed grows.
- Rendering the Inbox/My Jobs drawers is skipped when they're not the currently-open drawer (checked via `.classList.contains("show")`) — background relay events (a new listing from anyone, or an incoming DM) would otherwise rebuild that HTML on every single event even while invisible. Their "open" click handlers already render fresh content at open time, so this only defers work, it never causes stale content.
- Drawers share `openDrawer()`/`closeDrawers()`, which also handle focus management (focus moves into the drawer on open, returns to the trigger element on close) and Escape-to-close.
- Leaflet (map view) is not loaded until the user first switches to Map view (`loadLeaflet()`) — it used to be a render-blocking `<script>` in `<head>` loaded on every visit regardless of whether Map view was ever used.

### Reputation

Ratings are [NIP-32](https://github.com/nostr-protocol/nips/blob/master/32.md) label events (`kind: 1985`), namespaced with `["L", RATING_NAMESPACE]` (`com.stakrabbit.rating`) so the feed can tell our ratings apart from any other use of kind 1985. This reuses an existing NIP rather than inventing a bespoke kind for the same reason listings use NIP-99 and media uses NIP-92: any Nostr client that already understands labels can display them, not just this app.

A rating event tags `["p", ratedPubkey]` (who's being rated) and `["e", listingId]` (which job, using the app's existing `pubkey:dtag` listing-id convention — see the addressable-event note above — not a raw event id). The rater/ratee direction is implicit: `evt.pubkey` is always the rater, the `p` tag is always the ratee. `handleIncomingRating()` validates the namespace and a 1-5 numeric rating before accepting an event into `ratingEvents`; `getReputation()` aggregates client-side (average + count) for a given pubkey on demand — there's no server-computed score anywhere.

Unlike applications, rating events are public and unencrypted, so `ratingEvents` doesn't need local persistence the way `myApplications` does — a fresh relay subscription (`satrabbit-labels` in `connectRelays()`, shared with vouches — see "Verification tiers" below) reconstructs the full picture on any device.

`renderRatingWidget()` is the shared submit UI (1-5 stars + optional short text), used from both `renderJobDetailPostedView()` (poster rates each applicant) and `renderJobDetailAppliedView()` (tasker rates the poster). Both gate on the listing being closed, as the closest proxy this app has for "job completed." Once a listing has an `acceptedPubkey` (see "Quote/bidding flow" below), only that applicant can be rated/can rate back — before Accept existed (or for a poster who closes without ever accepting anyone), it falls back to allowing any applicant, since there's nothing more specific to key off.

**Sybil caveat:** nothing here stops a fresh pubkey from rating itself, or two colluding pubkeys from trading fake 5-star ratings — real sybil resistance would mean only counting a rating if it's tied to a job whose payment actually settled (see the escrow write-up), which this app doesn't implement. Treat scores as a lightweight social signal, not a verified guarantee.

### Verification tiers

A light-touch trust ladder, per the implementation guide's Tier 0-3 scheme — only Tier 0 and Tier 2 are implemented:

- **Tier 0 (default):** just a pubkey, no verification. There's nothing to build for this — it's the absence of a badge, matching the "no signup to browse" ethos. Don't add a "Tier 0" tag anywhere; badges should only appear when there's a positive signal to show.
- **Tier 1 (phone-linked) — deliberately not implemented.** Real OTP verification (SMS or otherwise) needs a server that can issue a code and later confirm it matches — there's no way to do that in pure client-side code with public relays. Even Nostr's own "OTP-over-DM" login convention (used by libraries like `nostr-login`) needs a server holding an app keypair and a pubkey→code database; it isn't a backend-free shortcut. Adding Tier 1 for real means picking and standing up one of: a small serverless function + SMS provider (e.g. Twilio), a hosted client-safe phone-auth service (e.g. Firebase Phone Auth), or a DM-based OTP server of our own — all of which are new infrastructure/vendor decisions, not just an index.html change.
- **Tier 2 (vouched):** implemented via `["L", VOUCH_NAMESPACE]` (`com.stakrabbit.vouch`) label events (`kind: 1985`, same NIP-32 mechanism as ratings) — `handleIncomingVouch()` records a `["p", vouchedPubkey]` tag from any pubkey, `getVouchCount()` counts *distinct* vouchers (a Set on `.from`, so one voucher spamming repeat vouches doesn't inflate the count), and `renderTierBadge()` shows "✓ Vouched" once a pubkey clears `VOUCH_THRESHOLD` (currently 2). Ratings and vouches share one relay subscription (`satrabbit-labels`, filtered by `#L` on both namespaces) and one dispatch branch in `connectRelays()`'s message handler, rather than doubling up REQs for the same event kind.
- **Tier 3 (ID-verified) — out of scope**, per product decision: it needs a paid third-party KYC API integration, which wasn't requested.

Unlike ratings, a vouch isn't tied to a job or gated on the voucher's own tier — with Tier 1 skipped there's no "existing Tier-1+ users" population to draw the gate from, so `renderVouchWidget()` (the shared submit UI, mirroring `renderRatingWidget()` but simpler — a yes/no attestation, not a 1-5 score) is available anywhere a specific pubkey is already in view (an applicant row, the poster's info in the applied view), with no job-completion or acceptance requirement. This carries the same sybil caveat as reputation: nothing stops fresh pubkeys vouching for each other in a ring.

### Currency and location

Prices are stored in GBP (`listing.price.gbp`) and converted for display only. On load, IP geolocation via `ipapi.co` sets the display currency; browser geolocation or a manual location search (reverse-)geocoded via Nominatim (`nominatim.openstreetmap.org`) can override it. Country → currency mapping is the hardcoded `COUNTRY_CURRENCY` table; the GBP→target FX rate comes from `frankfurter.app`. "Nearest" sort is disabled until a location reference (`refCoords`) exists.

**Map tiles gotcha:** `initMap()` serves the Voyager style from CARTO (`basemaps.cartocdn.com/rastertiles/voyager`), not `tile.openstreetmap.org`. The OSM Foundation's own tile server is meant for local/low-volume development only — its usage policy blocks third-party production sites that embed it without prior permission, and stakrabbit.com hit exactly that block (403 "Blocked" tiles) before this was switched. CARTO's paler `light_all` style was tried first but dropped for low contrast (roads/water/parks barely distinguishable) in favor of Voyager's fuller color. Don't point the tile layer back at `tile.openstreetmap.org` or `light_all`. Nominatim (`nominatim.openstreetmap.org`, used for search/reverse-geocoding above) is a separate OSM service with its own more permissive fair-use policy and isn't affected by this.

### PWA

`manifest.json` + `sw.js` + `icons/` (192/512/maskable/apple-touch/favicons, all cropped from the jumping-rabbit mark embedded in the header logo, on the `--moss-dark` brand green) make the page installable and give it basic offline access — the guide's Tier-7-style "cheapest path to app-like" item, and the only one of the guide's suggestions that needed literally no architectural tradeoff, since it's purely additive to a static page.

`sw.js` is **network-first**, not cache-first, for the app shell (`/`, `/index.html`, `/manifest.json`): this is a single evolving `index.html` with no versioned build output, so a cache-first strategy would leave installed users stuck on whatever they first loaded. Every successful same-origin GET re-caches its response as it flows through; only on a failed fetch (offline) does it fall back to whatever's cached. The fetch handler explicitly skips cross-origin requests (Nominatim, Blossom, ipapi.co, frankfurter.app, CARTO tiles, esm.sh/unpkg scripts) — relay WebSocket connections never go through the Fetch API at all, so they need no special-casing.

Service worker registration (in `<head>`, deferred to the `load` event) fails silently if it fails — e.g. served over plain `http://` on a non-localhost origin, where service workers are blocked entirely — since the app works fine without it either way.

**Known limitation:** this is app-shell caching only, not the guide's fuller vision of "cache job-board data for offline viewing" and "queue actions to sync when connectivity returns." A user who loses connection mid-session keeps whatever was already in memory (same as any tab), but there's no structured offline-listings cache or background-sync queue for things like offline-drafted applications.

## Known limitations

- Applications/message threads are local-only (see above) — no cross-device sync.
- DMs use NIP-04, which encrypts content but not metadata (relays can see who's messaging whom, and when) — NIP-17 would close that gap but isn't implemented.
- No pagination — the relay subscription fetches up to 50 listings; older ones fall off.
- Ratings aren't sybil-resistant (see "Reputation" above) — they're not gated on a real settled payment, so a determined bad actor can rate themselves or a colluding pubkey.
- Accepting an applicant is optional — a poster can still close a listing without ever hiring anyone through the app, in which case rating falls back to allowing any applicant (see "Reputation" above).
- Offer prices are parsed best-effort out of plain DM text (see "Quote/bidding flow" above), not a structured/signed field — a hand-crafted or non-stakrabbit application won't sort correctly if it doesn't follow the `Offering: £N` convention.
- Tier 1 (phone verification) is intentionally not implemented — see "Verification tiers" — so the trust ladder currently jumps straight from Tier 0 to Tier 2. Vouching (Tier 2) has the same sybil weakness as ratings: nothing stops fresh pubkeys vouching for each other.
- PWA offline support is app-shell caching only (see "PWA" above) — no offline listings cache, no background sync for actions taken while disconnected.
