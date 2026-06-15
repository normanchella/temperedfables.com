# Tempered Fables — static site

A lean, hand-coded static site for **Tempered Fables**, generated from the
show's Buzzsprout RSS feed. A *Wisteria* layer of the Eterna garden.

It auto-creates a page per episode, an episode index, playlists (by genre
and by season), an about page, and a persistent audio player — all from the
feed. No framework, no database.

## Quick start

```bash
cd temperedfables.com
npm run build      # generates ./dist from the live RSS (falls back to cache offline)
npm run serve      # builds, then previews at http://localhost:8080
```

There are no dependencies to install — it uses only built-in Node 18+ APIs.

## How it works

```
content.json       ← editable site text (title, tagline, links) — edit this
build.mjs          ← the generator (fetch RSS → parse → write ./dist)
feed-cache.rss     ← offline fallback + last-known-good copy of the feed
src/
  styles.css       ← all styling + brand tokens (top of the file)
  player.js        ← the persistent audio player
  about.html       ← editable About page copy (long-form prose)
serve.mjs          ← tiny local preview server
dist/              ← generated output — this is what you deploy (git-ignored)
.github/workflows/rebuild.yml  ← scheduled rebuild so new episodes appear
```

## Editing your text
- **Site copy** (title, tagline, kicker, subscribe links): `content.json`.
- **About page** (long-form): `src/about.html`.
- **Episodes**: not edited here — they come from the RSS feed automatically.

After editing, run `npm run build` (or just push — the Action rebuilds).

The generator tries the **live feed** first
(`https://feeds.buzzsprout.com/1374007.rss`). On success it refreshes
`feed-cache.rss`; if the network is unavailable it builds from that cache.
This sandbox has no outbound network, so the included `dist` was built from
the cache (5 episodes). **Your first real build will pull all 42.**

## New episodes appear automatically

Because Buzzsprout updates the RSS feed when you publish, the site just needs
to rebuild. The included GitHub Actions workflow rebuilds **daily** (and on
every push, and on demand). New episodes show up without you touching code.

Change the cadence by editing the `cron` line in `.github/workflows/rebuild.yml`.

## Deploying

You decided to keep the code on GitHub. Two good hosts:

### Option A — GitHub Pages (simplest, all-in-one)
1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The included workflow builds `dist` and deploys it. Done.
4. Add your custom domain under Settings → Pages (point `temperedfables.com`
   DNS at GitHub per their docs).

### Option B — Cloudflare Pages (faster network; great if your DNS is on Cloudflare)
1. Push to GitHub.
2. In Cloudflare Pages, **Connect to Git** → pick the repo.
3. Build command: `npm run build` · Output directory: `dist`.
4. Add `temperedfables.com` as a custom domain (automatic if DNS is on Cloudflare).
5. For scheduled rebuilds, create a **Deploy Hook** and ping it on a cron —
   see the commented block at the bottom of the workflow file.

Either way the deploy is a folder of static files, so you can switch hosts
anytime.

## Customising

- **Brand colours / fonts:** the tokens at the top of `src/styles.css`.
  This site uses the **Wisteria Eventide (Universe -1)** palette and type
  from the Eterna Brand Design Guide v1.0 — violet-black `#120e18`, orchid
  `#e8b4f8` titles, wisteria-purple `#c49cff` accent, body **Lora**, headings
  **Cormorant Garamond** (loaded from Google Fonts).
- **Show metadata, links, pen name:** the `CONFIG` object at the top of
  `build.mjs`.
- **About page:** edit `src/about.html`.
- **Player speeds, behaviour:** `src/player.js`.
