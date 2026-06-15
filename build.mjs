#!/usr/bin/env node
/* ============================================================
   Tempered Fables — static site generator
   ------------------------------------------------------------
   Reads the Buzzsprout RSS feed and generates a fully static
   site into ./dist : home, all-episodes, one page per episode,
   playlists (by genre + by season), about, and episodes.json.

   - No dependencies. Node 18+ (built-in fetch).
   - Tries the live feed first; falls back to ./feed-cache.rss
     if offline. A successful fetch refreshes the cache.

   Run:  npm run build   (or: node build.mjs)
   ============================================================ */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------- CONFIG ----------------------------
   Editable text lives in content.json. Paths/build settings stay here. */
const content = JSON.parse(await fs.readFile(path.join(__dirname, "content.json"), "utf8"));
const CONFIG = {
  ...content,
  outDir: path.join(__dirname, "dist"),
  srcDir: path.join(__dirname, "src"),
  cacheFile: path.join(__dirname, "feed-cache.rss"),
};

/* ---------------------------- HELPERS ---------------------------- */
const escapeHtml = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const slugify = (s = "") =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
   .replace(/['']/g, "").replace(/[^a-z0-9]+/g, "-")
   .replace(/^-+|-+$/g, "").slice(0, 80) || "episode";

const titleCase = (s = "") =>
  s.toLowerCase().replace(/(^|[\s-])(\w)/g, (_, p, c) => p + c.toUpperCase());

// Work out an episode's themes from (1) its itunes:keywords and
// (2) the "Genres include: …" line the author writes in the notes.
function deriveThemes(keywords = "", html = "", title = "") {
  const found = new Map(); // lowercase key -> display value
  const add = (raw) => {
    const g = (raw || "").replace(/[.\s]+$/, "").replace(/^[.\s]+/, "").trim();
    if (g.length > 1 && g.length <= 30 && !/^\d+$/.test(g)) {
      const disp = titleCase(g);
      found.set(disp.toLowerCase(), disp);
    }
  };
  if (keywords) keywords.split(",").forEach(add);

  // Split the notes into block-level segments so a label like
  // "<b>Genres include:</b> Romance." stays on one line, then read
  // the genre list out of any segment that mentions "genre".
  const segments = html
    .split(/<\/div>|<\/p>|<br\s*\/?>/i)
    .map((s) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim());
  for (const seg of segments) {
    const m = seg.match(/genres?\b[^a-z0-9]*(?:are|include)?\s*[:.]*\s*(.+)/i);
    if (m) {
      m[1]
        .split(/warnings?|music|no warning|there are no|rate us|enjoy/i)[0]
        .split(/[,.;]|\band\b|\bor\b/i)
        .forEach(add);
    }
  }
  if (/cloever'?s journal|reviewing \d{4}/i.test(title)) add("Cloever's Journal");
  if (/in memoriam|special episode/i.test(title)) add("Special");
  return [...found.values()];
}

// Pull the first capture group of a tag from a chunk of XML.
function tag(xml, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i");
  const m = xml.match(re);
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}
function attr(xml, name, a) {
  const re = new RegExp(`<${name}[^>]*\\b${a}="([^"]*)"`, "i");
  const m = xml.match(re);
  return m ? m[1] : "";
}

function fmtDuration(sec) {
  sec = parseInt(sec, 10) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtDate(d) {
  const date = new Date(d);
  if (isNaN(date)) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/* ---------------------------- LOAD FEED ---------------------------- */
async function loadFeed() {
  try {
    const res = await fetch(CONFIG.feedUrl, { headers: { "user-agent": "TemperedFablesBuild/1.0" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const xml = await res.text();
    if (xml.includes("<item")) {
      await fs.writeFile(CONFIG.cacheFile, xml); // refresh cache
      console.log("✓ Fetched live feed and refreshed cache.");
      return xml;
    }
    throw new Error("Feed had no items");
  } catch (err) {
    console.warn(`! Live feed unavailable (${err.message}). Using feed-cache.rss.`);
    return fs.readFile(CONFIG.cacheFile, "utf8");
  }
}

/* ---------------------------- PARSE ---------------------------- */
function parse(xml) {
  const channelHead = xml.split("<item")[0];
  const channel = {
    title: tag(channelHead, "title") || CONFIG.title,
    description: tag(channelHead, "description"),
    image: attr(channelHead, "itunes:image", "href") || tag(channelHead, "url"),
    author: tag(channelHead, "itunes:author"),
  };

  const items = [];
  const re = /<item[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const x = m[0];
    const title = tag(x, "itunes:title") || tag(x, "title");
    const descHtml = tag(x, "content:encoded") || tag(x, "description");
    const summary = (tag(x, "itunes:summary") ||
      descHtml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const audioUrl = attr(x, "enclosure", "url");
    if (!audioUrl) continue;
    const guid = tag(x, "guid") || audioUrl;
    const pubDate = tag(x, "pubDate");
    const durationSec = parseInt(tag(x, "itunes:duration"), 10) || 0;
    const season = tag(x, "itunes:season");
    const epNum = tag(x, "itunes:episode");
    const image = attr(x, "itunes:image", "href") || channel.image;
    const keywords = tag(x, "itunes:keywords");
    const genres = deriveThemes(keywords, descHtml, title);
    items.push({
      title, slug: slugify(title), descHtml,
      summary: summary.slice(0, 200) + (summary.length > 200 ? "…" : ""),
      audioUrl, guid, pubDate, dateISO: new Date(pubDate).toISOString(),
      dateLabel: fmtDate(pubDate),
      durationSec, durationLabel: fmtDuration(durationSec),
      season, epNum, image, genres,
    });
  }
  // newest first (feeds usually are, but enforce by date)
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return { channel, items };
}

/* ---------------------------- TEMPLATES ---------------------------- */
const head = (title, desc, canonical, ogImage) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${canonical}">
${ogImage ? `<meta property="og:image" content="${ogImage}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#120e18">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Lora:ital,wght@0,400;0,600;1,400&display=swap">
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>`;

const nav = `
<header class="site-head">
  <a class="brand" href="/"><span class="brand-mark">Tempered Fables</span></a>
  <nav>
    <a href="/episodes/">Episodes</a>
    <a href="/playlists/">Playlists</a>
    <a href="/about/">About</a>
  </nav>
</header>`;

const footer = `
<footer class="site-foot">
  <p class="foot-sub">Subscribe:
    <a href="${CONFIG.links.spotify}">Spotify</a> ·
    <a href="${CONFIG.links.rss}">RSS</a> ·
    <a href="${CONFIG.links.buzzsprout}">Buzzsprout</a>
  </p>
  <p class="foot-eterna">A <a href="${CONFIG.links.eterna}">Wisteria</a> layer of the Eterna garden · written under the pen name ${escapeHtml(CONFIG.penName)}</p>
</footer>`;

// The persistent player markup (lives at the bottom of every page).
const playerBar = `
<div id="player" class="player" hidden>
  <img id="pl-art" class="pl-art" alt="">
  <div class="pl-mid">
    <div class="pl-top">
      <button id="pl-prev" class="pl-btn" title="Previous">⏮</button>
      <button id="pl-play" class="pl-btn pl-play" title="Play/Pause">▶</button>
      <button id="pl-next" class="pl-btn" title="Next">⏭</button>
      <span id="pl-title" class="pl-title"></span>
      <button id="pl-rate" class="pl-rate" title="Playback speed">1×</button>
    </div>
    <div class="pl-bar">
      <span id="pl-cur" class="pl-time">0:00</span>
      <input id="pl-seek" class="pl-seek" type="range" min="0" max="100" value="0" step="0.1">
      <span id="pl-dur" class="pl-time">0:00</span>
    </div>
  </div>
  <audio id="pl-audio" preload="none"></audio>
</div>`;

const page = (opts) =>
  head(opts.title, opts.desc, opts.canonical, opts.ogImage) +
  nav + `<main class="wrap">` + opts.body + `</main>` + footer + playerBar +
  `<script src="/assets/player.js"></script></body></html>`;

// A reusable episode "card" with a play button wired to the player.
function epCard(ep) {
  return `
  <article class="ep-card">
    <a class="ep-art" href="/episodes/${ep.slug}/">
      <img loading="lazy" src="${ep.image}" alt="${escapeHtml(ep.title)} artwork">
    </a>
    <div class="ep-body">
      <h3 class="ep-title"><a href="/episodes/${ep.slug}/">${escapeHtml(ep.title)}</a></h3>
      <p class="ep-meta">${ep.dateLabel}${ep.season ? ` · Season ${ep.season}` : ""} · ${ep.durationLabel}</p>
      <p class="ep-sum">${escapeHtml(ep.summary)}</p>
      ${ep.genres.length ? `<p class="ep-genres">${ep.genres.map((g) => `<a class="chip" href="/playlists/${slugify(g)}/">${escapeHtml(g)}</a>`).join("")}</p>` : ""}
      <button class="play-btn"
        data-audio="${ep.audioUrl}"
        data-title="${escapeHtml(ep.title)}"
        data-image="${ep.image}"
        data-slug="${ep.slug}">▶ Play</button>
    </div>
  </article>`;
}

/* ---------------------------- RENDER ---------------------------- */
async function writePage(relDir, html) {
  const dir = path.join(CONFIG.outDir, relDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), html);
}

async function build() {
  const xml = await loadFeed();
  const { channel, items } = parse(xml);
  console.log(`✓ Parsed ${items.length} episodes.`);

  // reset dist
  await fs.rm(CONFIG.outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(CONFIG.outDir, "assets"), { recursive: true });

  // copy static assets
  for (const f of ["styles.css", "player.js"]) {
    await fs.copyFile(path.join(CONFIG.srcDir, f), path.join(CONFIG.outDir, "assets", f));
  }

  // ---- HOME ----
  const latest = items.slice(0, 8);
  const home = page({
    title: `${CONFIG.title} — ${CONFIG.tagline}`,
    desc: channel.description || CONFIG.tagline,
    canonical: CONFIG.siteUrl + "/",
    ogImage: channel.image,
    body: `
    <section class="hero">
      <img class="hero-art" src="${channel.image}" alt="${escapeHtml(CONFIG.title)} cover art">
      <div class="hero-text">
        <p class="kicker">${escapeHtml(CONFIG.kicker || "")}</p>
        <h1>${escapeHtml(CONFIG.title)}</h1>
        <p class="lead">${escapeHtml(CONFIG.tagline)}</p>
        <p>${escapeHtml(CONFIG.intro || (channel.description || "").replace(/For more info.*$/, "").trim())}</p>
        <p class="hero-cta">
          <a class="btn" href="/episodes/">All ${items.length} episodes</a>
          <a class="btn ghost" href="/playlists/">Browse playlists</a>
        </p>
      </div>
    </section>
    <section>
      <h2 class="sec-title">Latest stories</h2>
      <div class="ep-grid">${latest.map(epCard).join("")}</div>
      <p class="more"><a href="/episodes/">See all episodes →</a></p>
    </section>`,
  });
  await writePage(".", home);

  // ---- ALL EPISODES ----
  await writePage("episodes", page({
    title: `Episodes — ${CONFIG.title}`,
    desc: `All ${items.length} episodes of ${CONFIG.title}.`,
    canonical: CONFIG.siteUrl + "/episodes/",
    ogImage: channel.image,
    body: `
    <h1 class="page-title">All episodes</h1>
    <p class="page-sub">${items.length} stories, newest first.</p>
    <div class="ep-grid">${items.map(epCard).join("")}</div>`,
  }));

  // ---- EPISODE PAGES ----
  for (let i = 0; i < items.length; i++) {
    const ep = items[i];
    const prev = items[i + 1]; // older
    const next = items[i - 1]; // newer
    await writePage(`episodes/${ep.slug}`, page({
      title: `${ep.title} — ${CONFIG.title}`,
      desc: ep.summary,
      canonical: `${CONFIG.siteUrl}/episodes/${ep.slug}/`,
      ogImage: ep.image,
      body: `
      <article class="ep-single">
        <a class="back" href="/episodes/">← All episodes</a>
        <div class="ep-single-head">
          <img class="ep-single-art" src="${ep.image}" alt="${escapeHtml(ep.title)} artwork">
          <div>
            <h1>${escapeHtml(ep.title)}</h1>
            <p class="ep-meta">${ep.dateLabel}${ep.season ? ` · Season ${ep.season}` : ""}${ep.epNum ? ` · Episode ${ep.epNum}` : ""} · ${ep.durationLabel}</p>
            ${ep.genres.length ? `<p class="ep-genres">${ep.genres.map((g) => `<a class="chip" href="/playlists/${slugify(g)}/">${escapeHtml(g)}</a>`).join("")}</p>` : ""}
            <button class="play-btn big"
              data-audio="${ep.audioUrl}"
              data-title="${escapeHtml(ep.title)}"
              data-image="${ep.image}"
              data-slug="${ep.slug}">▶ Play episode</button>
          </div>
        </div>
        <div class="ep-notes">${ep.descHtml}</div>
        <nav class="ep-nav">
          ${prev ? `<a href="/episodes/${prev.slug}/">← ${escapeHtml(prev.title)}</a>` : "<span></span>"}
          ${next ? `<a href="/episodes/${next.slug}/">${escapeHtml(next.title)} →</a>` : "<span></span>"}
        </nav>
      </article>`,
    }));
  }

  // ---- PLAYLISTS (by genre + by season) ----
  const byGenre = {};
  for (const ep of items) for (const g of ep.genres) (byGenre[g] ||= []).push(ep);
  const bySeason = {};
  for (const ep of items) if (ep.season) (bySeason[ep.season] ||= []).push(ep);

  const genreNames = Object.keys(byGenre).sort();
  const seasonNames = Object.keys(bySeason).sort((a, b) => a - b);

  await writePage("playlists", page({
    title: `Playlists — ${CONFIG.title}`,
    desc: `Browse ${CONFIG.title} by genre and by season.`,
    canonical: CONFIG.siteUrl + "/playlists/",
    ogImage: channel.image,
    body: `
    <h1 class="page-title">Playlists</h1>
    <p class="page-sub">Browse the fables by theme, or work through a whole season.</p>
    <h2 class="sec-title">By theme</h2>
    <div class="pl-grid">
      ${genreNames.map((g) => `<a class="pl-tile" href="/playlists/${slugify(g)}/"><span>${escapeHtml(g)}</span><em>${byGenre[g].length}</em></a>`).join("") || "<p>No genre tags yet.</p>"}
    </div>
    <h2 class="sec-title">By season</h2>
    <div class="pl-grid">
      ${seasonNames.map((s) => `<a class="pl-tile" href="/playlists/season-${s}/"><span>Season ${s}</span><em>${bySeason[s].length}</em></a>`).join("") || "<p>No seasons tagged.</p>"}
    </div>`,
  }));

  for (const g of genreNames) {
    await writePage(`playlists/${slugify(g)}`, page({
      title: `${g} stories — ${CONFIG.title}`,
      desc: `${byGenre[g].length} ${g} stories from ${CONFIG.title}.`,
      canonical: `${CONFIG.siteUrl}/playlists/${slugify(g)}/`,
      ogImage: channel.image,
      body: `
      <a class="back" href="/playlists/">← All playlists</a>
      <h1 class="page-title">${escapeHtml(g)}</h1>
      <p class="page-sub">${byGenre[g].length} stories · <button class="play-btn" data-queue="${slugify(g)}">▶ Play all</button></p>
      <div class="ep-grid">${byGenre[g].map(epCard).join("")}</div>`,
    }));
  }
  for (const s of seasonNames) {
    await writePage(`playlists/season-${s}`, page({
      title: `Season ${s} — ${CONFIG.title}`,
      desc: `Season ${s} of ${CONFIG.title}.`,
      canonical: `${CONFIG.siteUrl}/playlists/season-${s}/`,
      ogImage: channel.image,
      body: `
      <a class="back" href="/playlists/">← All playlists</a>
      <h1 class="page-title">Season ${s}</h1>
      <p class="page-sub">${bySeason[s].length} stories · <button class="play-btn" data-queue="season-${s}">▶ Play all</button></p>
      <div class="ep-grid">${bySeason[s].map(epCard).join("")}</div>`,
    }));
  }

  // ---- ABOUT ----
  let aboutBody;
  try {
    aboutBody = await fs.readFile(path.join(CONFIG.srcDir, "about.html"), "utf8");
  } catch {
    aboutBody = `<h1 class="page-title">About</h1><p>${escapeHtml(channel.description)}</p>`;
  }
  await writePage("about", page({
    title: `About — ${CONFIG.title}`,
    desc: `What ${CONFIG.title} is about.`,
    canonical: CONFIG.siteUrl + "/about/",
    ogImage: channel.image,
    body: aboutBody,
  }));

  // ---- DATA for client player / playlists ----
  await fs.writeFile(
    path.join(CONFIG.outDir, "episodes.json"),
    JSON.stringify(
      {
        title: channel.title,
        image: channel.image,
        episodes: items.map((e) => ({
          slug: e.slug, title: e.title, audio: e.audioUrl, image: e.image,
          duration: e.durationSec, date: e.dateISO, season: e.season, genres: e.genres,
        })),
      },
      null, 2
    )
  );

  // 404 + robots + nojekyll (GitHub Pages friendliness)
  await fs.writeFile(path.join(CONFIG.outDir, "404.html"),
    page({ title: "Not found — " + CONFIG.title, desc: "Page not found.",
      canonical: CONFIG.siteUrl + "/404", ogImage: channel.image,
      body: `<h1 class="page-title">Lost in the fable</h1><p>That page doesn't exist. <a href="/">Return home →</a></p>` }));
  await fs.writeFile(path.join(CONFIG.outDir, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${CONFIG.siteUrl}/sitemap.xml\n`);
  await fs.writeFile(path.join(CONFIG.outDir, ".nojekyll"), "");
  // Custom domain file for GitHub Pages (harmless on other hosts)
  try {
    const host = new URL(CONFIG.siteUrl).host;
    if (host) await fs.writeFile(path.join(CONFIG.outDir, "CNAME"), host + "\n");
  } catch {}

  // sitemap
  const urls = ["/", "/episodes/", "/playlists/", "/about/",
    ...items.map((e) => `/episodes/${e.slug}/`),
    ...genreNames.map((g) => `/playlists/${slugify(g)}/`),
    ...seasonNames.map((s) => `/playlists/season-${s}/`)];
  await fs.writeFile(path.join(CONFIG.outDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${CONFIG.siteUrl}${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`);

  console.log(`✓ Built site to ${CONFIG.outDir}`);
  console.log(`  ${items.length} episodes · ${genreNames.length} genres · ${seasonNames.length} seasons`);
}

build().catch((e) => { console.error(e); process.exit(1); });
