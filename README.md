# stakrabbit

**Free Gig Market for local casual jobs** — lawnmowing, dog walking, cleaning, moving help, bar shifts, errands, and other odd jobs, posted and found locally.

stakrabbit is a decentralized classifieds board built on the [Nostr](https://nostr.com/) protocol. There's no company server behind it — listings, applications, and messages all travel over public Nostr relays. The app itself (`index.html`) is a single static HTML file with no build step and no backend to run; a `manifest.json` and service worker (`sw.js`) sit alongside it to make the site installable as a PWA.

## Features

- **Browse without signing up** — search, filter by category, sort by newest or nearest, switch between a card board and a map view
- **Post a job** — title, category, location, price, accepted payment methods (cash / bank transfer / Lightning), description, and optional photos, audio, or video
- **Apply for a job** — sends an end-to-end encrypted direct message to the poster, with a threaded conversation you can keep replying to. Counter-offer your own price rather than just applying at the asking price, and the poster can sort offers by price, rating, or recency and accept the one they want
- **My Jobs** — one place to see everything you've posted (with status and applications received) and everything you've applied to (with replies), including an edit view for your own listings
- **Reputation** — once a job is closed, poster and tasker can rate each other 1-5 stars with an optional short review. Ratings are signed Nostr events, not rows in a database, so they follow a pubkey to any compatible client, not just stakrabbit
- **Vouching** — anyone can vouch for another pubkey; once a pubkey has enough distinct vouchers it shows a "✓ Vouched" badge. This is the one implemented rung of a light-touch verification ladder — phone/SMS verification and paid ID checks are deliberately not implemented (see [`CLAUDE.md`](./CLAUDE.md) for why)
- **Log in with a Nostr key** — connect a browser extension (e.g. [Alby](https://getalby.com/)), generate a brand-new key in-browser, import an existing one, or connect a remote signer / "bunker" (e.g. [Amber](https://github.com/greenart7c3/Amber) on Android, or [nsec.app](https://nsec.app) on any device) via [nostr-login](https://github.com/nostrband/nostr-login) so your key never touches this browser at all. Locally-generated keys can be encrypted at rest with a passphrase.
- **Live currency conversion** — prices are entered in GBP and converted for display based on your detected location
- **Media attachments** — photos/audio/video upload to a [Blossom](https://github.com/hzrd149/blossom) media server and attach to your listing
- **Installable** — "Add to Home Screen" on mobile or install as a desktop app; a service worker caches the app shell so it still loads (with whatever was last fetched) when you're offline

## Running it

No install, no build step. Either:

- Open `index.html` directly in a browser, or
- Serve it locally so geolocation and network calls behave normally under `http://`:

  ```
  python3 -m http.server 8000
  ```

  then visit `http://localhost:8000/`.

## How it works

There's no backend server or database. Instead:

- **Listings** are published as [NIP-99](https://github.com/nostr-protocol/nips/blob/master/99.md) classified-listing events on public Nostr relays, tagged so the app can find them.
- **Applications and replies** are encrypted Nostr direct messages between the applicant and the poster.
- **Media** (photos, audio, video) is uploaded to a Blossom server and referenced by URL from the listing.
- **Ratings and vouches** are [NIP-32](https://github.com/nostr-protocol/nips/blob/master/32.md) label events on the same public relays — aggregated client-side from whatever a pubkey has received, not stored or computed by any server.
- **Accounts** are just Nostr keypairs — there's no username/password system, no server-side accounts, and no company that can lock you out or lose your data.

Because everything lives on the Nostr network, anyone running a compatible client can see and interact with the same listings — stakrabbit is a view into that shared network, not a walled garden.

## Status

This is a working prototype, not a production service. Payments (cash, bank transfer, Lightning) are always coordinated directly between the two parties — the app never handles or stores money or bank details.

---

*Want the technical architecture notes instead? See [`CLAUDE.md`](./CLAUDE.md) — though it currently describes an earlier version of the app and could use a refresh.*
