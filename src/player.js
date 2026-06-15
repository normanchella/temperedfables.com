/* ============================================================
   Tempered Fables — persistent audio player
   - Plays single episodes or whole playlists (genre / season).
   - Remembers the current track + position across page loads
     (sessionStorage), so the story keeps playing as you browse.
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = "tf-player";

  const el = {
    bar: $("player"), audio: $("pl-audio"), art: $("pl-art"),
    title: $("pl-title"), play: $("pl-play"), prev: $("pl-prev"),
    next: $("pl-next"), seek: $("pl-seek"), cur: $("pl-cur"),
    dur: $("pl-dur"), rate: $("pl-rate"),
  };
  if (!el.bar) return;

  const RATES = [1, 1.25, 1.5, 1.75, 2];
  let state = { queue: [], index: 0, position: 0, rate: 1, playing: false };

  function slugify(s) {
    return (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/['']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  const fmt = (sec) => {
    sec = Math.floor(sec || 0);
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  };

  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        queue: state.queue, index: state.index,
        position: el.audio.currentTime || 0, rate: state.rate,
        playing: !el.audio.paused,
      }));
    } catch (e) {}
  }

  function current() { return state.queue[state.index]; }

  function load(track, autoplay) {
    el.audio.src = track.audio;
    el.audio.playbackRate = state.rate;
    el.art.src = track.image || "";
    el.title.textContent = track.title || "";
    el.bar.hidden = false;
    document.body.classList.add("has-player");
    if (autoplay) el.audio.play().catch(() => {});
    save();
  }

  function setQueue(list, index, autoplay) {
    state.queue = list;
    state.index = index || 0;
    load(current(), autoplay);
  }

  function playSingle(track) {
    // start a one-item queue (or jump within current queue if present)
    setQueue([track], 0, true);
  }

  async function getEpisodes() {
    if (window.__tfEpisodes) return window.__tfEpisodes;
    const res = await fetch("/episodes.json");
    const data = await res.json();
    window.__tfEpisodes = data.episodes || [];
    return window.__tfEpisodes;
  }

  async function playPlaylist(key) {
    const eps = await getEpisodes();
    let list;
    if (key.startsWith("season-")) {
      const s = key.slice(7);
      list = eps.filter((e) => String(e.season) === s);
    } else {
      list = eps.filter((e) => (e.genres || []).some((g) => slugify(g) === key));
    }
    list = list.map((e) => ({ audio: e.audio, title: e.title, image: e.image, slug: e.slug }));
    if (list.length) setQueue(list, 0, true);
  }

  /* ---- controls ---- */
  el.play.addEventListener("click", () => {
    if (el.audio.paused) el.audio.play(); else el.audio.pause();
  });
  el.prev.addEventListener("click", () => {
    if (el.audio.currentTime > 3) { el.audio.currentTime = 0; return; }
    if (state.index > 0) { state.index--; load(current(), true); }
  });
  el.next.addEventListener("click", () => {
    if (state.index < state.queue.length - 1) { state.index++; load(current(), true); }
  });
  el.rate.addEventListener("click", () => {
    const i = (RATES.indexOf(state.rate) + 1) % RATES.length;
    state.rate = RATES[i];
    el.audio.playbackRate = state.rate;
    el.rate.textContent = state.rate + "×";
    save();
  });
  el.seek.addEventListener("input", () => {
    if (el.audio.duration) el.audio.currentTime = (el.seek.value / 100) * el.audio.duration;
  });

  el.audio.addEventListener("play", () => { el.play.textContent = "⏸"; save(); });
  el.audio.addEventListener("pause", () => { el.play.textContent = "▶"; save(); });
  el.audio.addEventListener("timeupdate", () => {
    el.cur.textContent = fmt(el.audio.currentTime);
    if (el.audio.duration) el.seek.value = (el.audio.currentTime / el.audio.duration) * 100;
  });
  el.audio.addEventListener("loadedmetadata", () => {
    el.dur.textContent = fmt(el.audio.duration);
  });
  el.audio.addEventListener("ended", () => {
    if (state.index < state.queue.length - 1) { state.index++; load(current(), true); }
  });
  setInterval(save, 5000);
  window.addEventListener("beforeunload", save);

  /* ---- wire up buttons on the page ---- */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".play-btn");
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.queue) { playPlaylist(btn.dataset.queue); return; }
    if (btn.dataset.audio) {
      playSingle({
        audio: btn.dataset.audio, title: btn.dataset.title,
        image: btn.dataset.image, slug: btn.dataset.slug,
      });
    }
  });

  /* ---- restore previous session ---- */
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (saved && saved.queue && saved.queue.length) {
      state.queue = saved.queue;
      state.index = saved.index || 0;
      state.rate = saved.rate || 1;
      el.rate.textContent = state.rate + "×";
      load(current(), false);
      el.audio.addEventListener("loadedmetadata", function once() {
        el.audio.currentTime = saved.position || 0;
        if (saved.playing) el.audio.play().catch(() => {});
        el.audio.removeEventListener("loadedmetadata", once);
      });
    }
  } catch (e) {}
})();
