(() => {
"use strict";

/* ============ basics ============ */
const EASE = "cubic-bezier(.1,.9,.2,1)";      // fast start, long soft landing
const EASE_IN = "cubic-bezier(.6,0,.9,.45)";  // for things leaving the screen
const EASE_HERO = "cubic-bezier(.35,0,.1,1)"; // the menu word growing into a title
// set by the Android (Shield) app: there is no Windows helper there, the app itself does those jobs
const NATIVE = window.MCAndroid || null;
const HELPER = NATIVE ? "http://127.0.0.1:8765" : "";
const $stage = document.getElementById("stage");
const $pages = document.getElementById("pages");
const $bgImg = document.getElementById("bgimg");

// the window's real size (on Android TV innerWidth can grow with whatever sticks out past the screen)
const viewW = () => document.documentElement.clientWidth || innerWidth;
const viewH = () => document.documentElement.clientHeight || innerHeight;
function fit() {
  const s = Math.min(viewW() / 1920, viewH() / 1080);
  $stage.style.transform = `translate(-50%,-50%) scale(${s})`;
}
addEventListener("resize", fit); fit();

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtT = s => s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}` : fmt(s); // movies: 1:42:05
const fmtLong = s => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const qa = (root, sel) => [...root.querySelectorAll(sel)];
const done = a => a.finished.catch(() => {});
const lower = s => String(s || "").toLowerCase();

// picture for an album / movie / show: the real one from Emby, or a generated stand-in
const genCover = x => Art.album({ id: (x && x.id) || "x", title: (x && x.title) || "", hue: (x && x.hue) || 0 });
const coverList = x => (x && (x.imgs || (x.img ? [x.img] : []))) || [];
const cover = x => coverList(x)[0] || genCover(x);
const imgTag = (src, cls = "") => `<img${cls ? ` class="${cls}"` : ""} src="${esc(src)}" alt="" loading="lazy" decoding="async">`;
// album art with fallbacks: if a picture fails to load, try the next place Emby might keep it,
// and finally a generated cover (see the error listener below)
const coverAttrs = x => {
  const list = coverList(x);
  return `data-alt="${esc(list.slice(1).join(" "))}" data-fid="${esc((x && x.id) || "x")}" data-fhue="${(x && x.hue) || 0}" data-ftitle="${esc((x && x.title) || "")}"`;
};
const coverTag = (x, cls = "") => `<img${cls ? ` class="${cls}"` : ""} src="${esc(cover(x))}" ${coverAttrs(x)} alt="" loading="lazy" decoding="async">`;
function setCover(img, x) {
  const list = coverList(x);
  Object.assign(img.dataset, { alt: list.slice(1).join(" "), fid: (x && x.id) || "x", fhue: (x && x.hue) || 0, ftitle: (x && x.title) || "" });
  img.src = cover(x);
}
document.addEventListener("error", e => {
  const img = e.target;
  if (!img || img.tagName !== "IMG" || img.dataset.fid === undefined) return;
  const alt = (img.dataset.alt || "").split(" ").filter(Boolean);
  if (alt.length) { img.dataset.alt = alt.slice(1).join(" "); img.src = alt[0]; return; }
  const x = { id: img.dataset.fid, hue: +img.dataset.fhue || 0, title: img.dataset.ftitle || "" };
  delete img.dataset.fid;
  img.src = genCover(x);
}, true);

// position of an element on the 1920x1080 stage
function stageRect(e) {
  const st = $stage.getBoundingClientRect(), k = st.width / 1920, r = e.getBoundingClientRect();
  return { x: (r.left - st.left) / k, y: (r.top - st.top) / k, w: r.width / k, h: r.height / k };
}

/* ============ theme (settings → appearance) ============
   text color: sets --fg in styles.css (dim shades are mixed from it)
   background: which wallpaper art.js draws behind menus (real pictures like artist photos still win) */
const Theme = {
  COLORS: [
    ["white", "#ffffff"], ["zune pink", "#ff4fb6"], ["zune orange", "#ff9a2e"],
    ["media center blue", "#7cc4ff"], ["lime", "#b5e853"], ["warm white", "#f3e9d2"],
  ],
  load() { try { return JSON.parse(localStorage.getItem("mc.theme")) || {}; } catch { return {}; } },
  save(o) { try { localStorage.setItem("mc.theme", JSON.stringify({ ...this.load(), ...o })); } catch {} },
  get fg() { const v = this.load().fg; return this.COLORS.some(c => c[0] === v) ? v : "white"; },
  get bg() { const v = this.load().bg; return Art.walls.includes(v) ? v : "zune"; },
  apply() {
    document.documentElement.style.setProperty("--fg", this.COLORS.find(c => c[0] === this.fg)[1]);
    Art.setWallpaper(this.bg);
  },
  next(kind) { // cycle to the next choice
    if (kind === "fg") { const i = this.COLORS.findIndex(c => c[0] === this.fg); this.save({ fg: this.COLORS[(i + 1) % this.COLORS.length][0] }); }
    else { const i = Art.walls.indexOf(this.bg); this.save({ bg: Art.walls[(i + 1) % Art.walls.length] }); }
    this.apply();
  },
};
Theme.apply();

/* ============ playback preferences (settings → playback) ============ */
// what the screensaver for when nothing plays can show (settings → playback; app.js: IdleSaver)
const IDLE_KINDS = [["movies", "movies"], ["shows", "tv shows"], ["guide", "tv guide (on now)"], ["recordings", "recordings"], ["music", "music"], ["photos", "your photos"]];
const Prefs = {
  DEFAULTS: { npHide: 5, npArt: "hide", liveHide: 5, osdHide: 5, guideOk: "info", musicVol: 100, saver: 60, pip: "four", cc: false, ytcc: false, ytOpen: "native", fps: "on", npAnim: "zoom", saverLook: "zune", idleSaver: 5, idleLook: "backdrops",
    idle_movies: true, idle_shows: true, idle_guide: true, idle_recordings: true, idle_music: true, idle_photos: false, guideNums: "on",
    chHidden: [], chFav: [], guideSpan: 3, lastCh: true, startup: "home", clock: "12", textSize: "normal", nextEp: 10, skipBack: 10, skipFwd: 30 },
  load() { try { return { ...this.DEFAULTS, ...(JSON.parse(localStorage.getItem("mc.prefs")) || {}) }; } catch { return { ...this.DEFAULTS }; } },
  get(k) { return this.load()[k]; },
  set(k, v) { try { localStorage.setItem("mc.prefs", JSON.stringify({ ...this.load(), [k]: v })); } catch {} },
};
// the tv guide's channel label: "7.1 WKRN", or just "WKRN" when settings → playback → channel numbers in guide is off
const guideNums = () => Prefs.get("guideNums") !== "off";
const guideCh = ch => (guideNums() && ch.number ? `${ch.number} ${ch.name}` : ch.name);
// settings → channels: hidden channels leave the guide (and channel up / down); favorites go to the top
function arrangeChannels(list) {
  const hidden = new Set(Prefs.get("chHidden") || []), fav = new Set(Prefs.get("chFav") || []);
  const shown = list.filter(c => !hidden.has(c.id));
  if (!shown.length) return list; // everything hidden would leave an empty guide: show them all instead
  return [...shown.filter(c => fav.has(c.id)), ...shown.filter(c => !fav.has(c.id))];
}
// a channel list for the player that still contains ch, even when ch is a hidden channel (asked for by voice or the Emby app)
function channelsWith(all, ch) {
  const list = arrangeChannels(all);
  return list.includes(ch) ? list : [ch, ...list];
}
// settings → playback: how far ← / → (and the skip buttons) jump in live tv, movies, shows and youtube
const skipBy = d => (d > 0 ? Number(Prefs.get("skipFwd")) || 30 : -(Number(Prefs.get("skipBack")) || 10));
// settings → appearance → text size
function applyTextSize() { document.documentElement.classList.toggle("big-text", Prefs.get("textSize") === "large"); }
applyTextSize();

// small message at the bottom of the screen
let toastTimer = null;
function toast(text) {
  let t = document.getElementById("toast");
  if (!t) { t = el("div", "toast"); t.id = "toast"; $stage.append(t); }
  t.textContent = text;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 3200);
}

/* ============ the Zune-style motion ============ */
// Only animate what's actually on screen (and inside its list's visible window).
function visibleT(root) {
  const W = viewW(), H = viewH();
  return qa(root, ".t").filter(e => {
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const clip = e.closest(".list");
    const b = clip ? clip.getBoundingClientRect() : { top: 0, bottom: H };
    return r.bottom > b.top && r.top < b.bottom && r.right > 0 && r.left < W;
  });
}
// The fades below leave out full brightness on purpose: each piece fades from / to its OWN brightness,
// so dimmed words (the hub menu beside quickplay) stay dim while the screen comes and goes.
const cancelTurn = e => e.getAnimations().forEach(a => a.id === "turn" && a.cancel());
// Zoom an item by `s` around the middle of the screen, so a whole page moves together like a camera.
// Items keep their own pivot (their center); the shift toward/away from the screen center is worked
// out here instead. (Changing the pivot mid-flight made highlighted, enlarged covers jump.)
function zoomAbout(e, s) {
  const r = stageRect(e), ox = r.x + r.w / 2, oy = r.y + r.h / 2;
  return `translate(${(1 - s) * (960 - ox)}px, ${(1 - s) * (540 - oy)}px) scale(${s})`;
}

// ZOOM IN (Media Center style): going deeper, items rise from slightly smaller and fade in;
// going back, they settle from slightly larger. A light top-to-bottom ripple keeps it lively.
// (Named turnIn/turnOut for history: these used to be 3D turnstile swings.)
function turnIn(els, dir, { dur = 520, stagger = 22, delay = 0 } = {}) {
  stagger = Math.min(stagger, 260 / Math.max(1, els.length));
  return Promise.all(els.map((e, i) => {
    cancelTurn(e);
    return done(e.animate([
      { opacity: 0, transform: zoomAbout(e, dir > 0 ? 0.86 : 1.14) },
      { transform: "translate(0px, 0px) scale(1)" },
    ], { id: "turn", duration: dur, delay: delay + i * stagger, easing: EASE, fill: "backwards" }));
  }));
}
// ZOOM OUT: going deeper, the old items zoom slightly past you and fade; going back, they shrink away.
function turnOut(els, dir, { dur = 240, stagger = 12 } = {}) {
  stagger = Math.min(stagger, 120 / Math.max(1, els.length));
  return Promise.all(els.map((e, i) => {
    cancelTurn(e);
    return done(e.animate([
      { transform: "translate(0px, 0px) scale(1)" },
      { opacity: 0, transform: zoomAbout(e, dir > 0 ? 1.14 : 0.88) },
    ], { id: "turn", duration: dur, delay: i * stagger, easing: EASE_IN, fill: "forwards" }));
  }));
}

// HEADERS. Forward: the old header zooms up toward you and fades; the new title rises into place.
function headerOut(els, dir) {
  return Promise.all(els.map(e => done(e.animate(dir > 0 ? [
    { opacity: 1, transform: "none" },
    { opacity: 0, transform: "scale(2.3)" },
  ] : [
    { opacity: 1, transform: "none" },
    { opacity: 0, transform: "translateY(240px) scale(.9)" },
  ], { id: "turn", duration: dir > 0 ? 340 : 260, easing: EASE_IN, fill: "forwards" }))));
}
function titleIn(els, dir, delay = 0) {
  return Promise.all(els.map(e => done(e.animate(dir > 0 ? [
    { opacity: 0, transform: "translateY(260px) scale(.9)" },
    { opacity: 1, offset: 0.25 },
    { opacity: 1, transform: "none" },
  ] : [
    { opacity: 0, transform: "scale(1.9)" },
    { opacity: 1, transform: "none" },
  ], { id: "turn", duration: 700, delay, easing: EASE, fill: "backwards" }))));
}
function subIn(els, dir, delay = 160) {
  return Promise.all(els.map(e => done(e.animate([
    { opacity: 0, transform: `translateX(${dir > 0 ? 160 : -160}px)` },
    { transform: "none" },
  ], { id: "turn", duration: 550, delay, easing: EASE, fill: "backwards" }))));
}

// COVERS (album art, posters, show pictures) zoom in from their own center as they arrive / leave.
// (Named flipIn/flipOut for history: these used to spin in 3D.)
function flipIn(els, dir, delay = 120) {
  return Promise.all(els.map(e => {
    e.style.transformOrigin = "50% 50%";
    return done(e.animate([
      { opacity: 0, transform: `scale(${dir > 0 ? 0.8 : 1.15})` },
      { transform: "scale(1)" },
    ], { id: "turn", duration: 600, delay, easing: EASE, fill: "backwards" }));
  }));
}
function flipOut(els, dir) {
  return Promise.all(els.map(e => done(e.animate([
    { transform: "scale(1)" },
    { opacity: 0, transform: `scale(${dir > 0 ? 1.15 : 0.85})` },
  ], { id: "turn", duration: 260, easing: EASE_IN, fill: "forwards" }))));
}

// SLIDE: plain sideways glide inside a page (pivot lists, track changes, the menu clearing away).
function slideIn(els, dir, { dist = 230, dur = 600, stagger = 42 } = {}) {
  stagger = Math.min(stagger, 420 / Math.max(1, els.length));
  return Promise.all(els.map((e, i) => {
    cancelTurn(e);
    return done(e.animate([
      { opacity: 0, transform: `translateX(${dir * dist}px)` },
      { transform: "none" },
    ], { id: "turn", duration: dur, delay: i * stagger, easing: EASE, fill: "backwards" }));
  }));
}
function slideOut(els, dir, { dist = 180, dur = 230, stagger = 30 } = {}) {
  stagger = Math.min(stagger, 200 / Math.max(1, els.length));
  return Promise.all(els.map((e, i) => {
    cancelTurn(e);
    return done(e.animate([
      { transform: "none" },
      { opacity: 0, transform: `translateX(${-dir * dist}px)` },
    ], { id: "turn", duration: dur, delay: i * stagger, easing: EASE_IN, fill: "forwards" }));
  }));
}

// PRESS: the chosen item dips in briefly when you press Enter (named tilt for history).
function tilt(e) {
  if (!e) return;
  e.style.transformOrigin = "50% 50%";
  e.animate([
    { transform: "none" },
    { transform: "scale(.94)", offset: 0.4 },
    { transform: "none" },
  ], { duration: 240, easing: "ease-out" });
}

// HERO: a word from the home menu grows into the giant title of the next screen (and back).
const TITLE = { x: 56, y: -205, font: 460 }; // must match .sec-title in styles.css
// Two copies travel together: the menu word as written ("Movies") and the title in capitals
// ("MOVIES"). They cross-fade on the way, so the change of case blends into the growth.
function heroGhosts(id, pan) {
  const word = el("div", "sec-title ghost asis", esc(MENU_LABEL[id] || id));
  const caps = el("div", "sec-title ghost", esc(id));
  [word, caps].forEach(g => { if (pan) g.style.translate = pan; $stage.append(g); });
  return [word, caps];
}
// toTitle: true = menu word → title (forward), false = title → menu word (back)
function heroFly([word, caps], from, to, toTitle, duration) {
  const opts = { duration, easing: EASE_HERO, fill: "both" };
  const move = [{ transform: from }, { transform: to }];
  if (!toTitle) move[1].translate = "0 0"; // the title may be shifted sideways; the menu word isn't
  const fly = caps.animate(move, opts);
  word.animate(move, opts);
  const fade = (a, b) => [{ opacity: a }, { opacity: a, offset: 0.2 }, { opacity: b, offset: 0.7 }, { opacity: b }];
  word.animate(toTitle ? fade(1, 0) : fade(0, 1), { duration, fill: "both" });
  caps.animate(toTitle ? fade(0, 1) : fade(1, 0), { duration, fill: "both" });
  return fly;
}
function heroFrom(item) { // transform that makes the ghost sit exactly on a menu word
  const r = stageRect(item), font = parseFloat(getComputedStyle(item).fontSize);
  const lh = parseFloat(getComputedStyle(item).lineHeight) || font;
  const s = font / TITLE.font;
  return `translate(${r.x - TITLE.x}px, ${r.y + (lh - font) / 2 - TITLE.y}px) scale(${s})`;
}

/* ============ player: real audio for Emby music, simulated for the sample library ============ */
const audio = new Audio();
audio.preload = "auto";
// App volume (0–100): what voice "volume up / down / 30" changes, and what the assistant lowers while it
// talks. Music and radio are further scaled by settings → playback → music volume (music is mastered
// louder than tv). Live tv uses the app volume as is.
const Volume = {
  level: 100, muted: false, video: null, // video: the live tv player, handed over by Live.init()
  apply() {
    const v = this.muted ? 0 : this.level / 100;
    audio.volume = v * Prefs.get("musicVol") / 100;
    if (this.video) this.video.volume = v;
    document.querySelectorAll(".vod-video").forEach(m => { m.volume = v; }); // a movie playing
    if (window.__ytPlayer) try { window.__ytPlayer.setVolume(Math.round(v * 100)); } catch {} // a youtube video
  },
  set(n) { this.level = Math.round(clamp(Number(n) || 0, 0, 100)); this.muted = false; this.apply(); return this.level; },
};
Volume.apply();
const Player = {
  queue: [], i: 0, pos: 0, playing: false,
  get track() { return this.queue[this.i] || null; },
  get dur() { const t = this.track; return t && t.stream && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (t ? t.dur : 0); },
  peek() { return this.queue.length > 1 ? this.queue[(this.i + 1) % this.queue.length] : null; },
  load() {
    const t = this.track;
    this.pos = 0;
    if (t && t.stream) {
      audio.src = t.stream;
      if (this.playing) audio.play().catch(err => toast(`couldn't play this ${t.live ? "station" : "song"} — ` + lower(err.message)));
    } else { audio.pause(); audio.removeAttribute("src"); }
    Radio.watch(t); // radio: keep the song / artist / cover up to date
  },
  play(q, i) { Live.stop(); BgVod.stop(); this.queue = q; this.i = i; this.playing = true; this.load(); emit("track", 1); }, // music stops live tv
  toggle() {
    if (!this.track) return;
    this.playing = !this.playing;
    if (this.track.stream) { if (this.playing) audio.play().catch(() => {}); else audio.pause(); }
    emit("state");
  },
  // stop: end the music or radio completely (not just pause); the ▶ on the home menu goes away
  stop() {
    if (!this.track) return;
    this.queue = []; this.i = 0; this.pos = 0; this.playing = false;
    audio.pause(); audio.removeAttribute("src"); audio.load();
    Radio.watch(null);
    emit("stop");
  },
  next() { if (!this.track) return; this.i = (this.i + 1) % this.queue.length; this.playing = true; this.load(); emit("track", 1); },
  prev() {
    if (!this.track) return;
    if (this.pos > 3 && !this.track.live) { this.pos = 0; if (this.track.stream) audio.currentTime = 0; emit("tick"); return; }
    this.i = (this.i - 1 + this.queue.length) % this.queue.length; this.load(); emit("track", -1);
  },
};
audio.addEventListener("ended", () => Player.next());
audio.addEventListener("error", () => {
  const t = Player.track;
  if (!t || !t.stream || !audio.src) return;
  // radio: try the station's other stream addresses before giving up
  if (t.live && t.alt && t.alt.length) { t.stream = t.alt.shift(); audio.src = t.stream; if (Player.playing) audio.play().catch(() => {}); return; }
  toast(t.live ? "this station couldn't be played — check your listen key in settings → radio" : "this song couldn't be streamed from emby");
});
function emit(evt, arg) { const p = top(); if (p && p.el) p.player(evt, arg); }
setInterval(() => {
  const t = Player.track;
  if (!Player.playing || !t) return;
  if (t.stream) Player.pos = audio.currentTime || 0;
  else { Player.pos += 0.25; if (Player.pos >= t.dur) return Player.next(); }
  emit("tick");
}, 250);

/* ============ page stack & navigation ============ */
const stack = [];
let busy = false;
const top = () => stack[stack.length - 1];

class Page {
  mount() { this.el = this.render(); this.el.classList.add("page"); $pages.append(this.el); this.mounted(); }
  unmount() { this.el.remove(); this.el = null; }
  mounted() {}
  // .z = giant title, .zs = small header line under it, .t = items (turnstile), .flip = covers
  // `wait` delays the whole entrance; everything stays hidden until its turn comes.
  enter(dir, { skipTitle = false, wait = 0 } = {}) {
    return Promise.all([
      skipTitle ? null : titleIn(qa(this.el, ".z"), dir, wait),
      subIn(qa(this.el, ".zs"), dir, wait + (skipTitle ? 0 : 160)),
      turnIn(visibleT(this.el), dir, { delay: wait + (skipTitle ? 40 : 140) }),
      flipIn(qa(this.el, ".flip"), dir, wait + 120),
    ]);
  }
  leave(dir, { skipTitle = false } = {}) {
    let els = visibleT(this.el);
    if (dir > 0) { // the chosen item leaves last, like on the Zune
      const f = els.filter(e => e.classList.contains("focus"));
      els = els.filter(e => !f.includes(e)).concat(f);
    }
    return Promise.all([
      turnOut(els, dir),
      headerOut(qa(this.el, skipTitle ? ".zs" : ".z, .zs"), dir),
      flipOut(qa(this.el, ".flip"), dir),
    ]);
  }
  bg() { return { opacity: 0.25 }; }
  key() { return false; }
  player() {}
  // the giant section title this page shows ("music", "movies"…), or null for none.
  // Moving between two pages with the same title leaves the title where it is.
  get titleKey() { return null; }
  // where this page wants its title to sit sideways (pivot pages drift it per section); null = keep where it is
  titlePan() { return null; }
}

// Same title on both pages: the new title starts exactly where the old one was, so it doesn't move.
// (A pivot page then eases its title to the spot that matches its current section.)
const sameTitle = (a, b) => !!(a && b && a.titleKey && a.titleKey === b.titleKey);
const titlePanOf = p => { const t = p.el && p.el.querySelector(".z"); return (t && t.style.translate) || "0px 0px"; };
function holdTitle(page, fromPan) {
  const t = page.el.querySelector(".z");
  if (!t) return;
  t.style.transition = "none";
  t.style.translate = fromPan;
  void t.offsetWidth; // commit the starting spot before turning the glide back on
  t.style.transition = "";
  const target = page.titlePan();
  if (target && target !== fromPan) t.style.translate = target;
}

/* ============ the Zune HD AV Dock's "start playing" move (settings → appearance → now playing animation) ============
   Opening now playing: the current screen folds away on a hinge
   down the left edge of the TV, piece by piece from the top; a beat of empty screen; then now playing
   swings in on the same hinge, each piece a thin sliver at the far left opening out to its place.
   Back from now playing does the same the other way. */
const DOCK_FOLD = "cubic-bezier(.45,.05,.75,.45)";  // speeding up as it folds away
const DOCK_SWING = "cubic-bezier(.3,.45,.2,1)";     // a thin sliver for ~70 ms, mostly open by ~200 ms, settled ~450 ms
// Every piece turns about the same line (the TV's left edge) and is seen from the middle of the TV,
// wherever it sits in the page: the 3D is worked out from the middle of the screen.
// (The piece keeps its own pivot point: the trip to the middle of the TV and back is part of the
// movement itself. Moving the pivot instead made the picked button, which is drawn a little bigger,
// jump the moment a swing started.)
function dockFrames(e, from, to) {
  const sr = $stage.getBoundingClientRect(), k = sr.width / 1920 || 1, r = e.getBoundingClientRect();
  const cs = getComputedStyle(e), s = parseFloat(cs.scale) || 1;
  const [px, py] = cs.transformOrigin.split(" ").map(parseFloat);
  // where the piece's pivot sits on the TV (a bigger, picked button is grown around that same point)
  const ox = (r.left - sr.left) / k + px * s, oy = (r.top - sr.top) / k + py * s;
  const dx = 960 - ox, dy = 540 - oy;
  const at = a => `translate(${dx}px, ${dy}px) perspective(1500px) translateX(-960px) rotateY(${a}deg) translateX(960px) translate(${-dx}px, ${-dy}px)`;
  return [from, to].map(f => ({ ...f, transform: at(f.a) })).map(({ a, ...f }) => f);
}
// the pieces of a screen, top to bottom (the giant title first), only what's on screen
function dockPieces(page) {
  const els = [...qa(page.el, ".z"), ...qa(page.el, ".zs"), ...qa(page.el, ".flip"), ...visibleT(page.el)];
  const seen = new Set(), list = els.filter(e => !seen.has(e) && seen.add(e) && e.getBoundingClientRect().width > 0);
  // a piece inside another piece moves with it
  const top = list.filter(e => !list.some(o => o !== e && o.contains(e)));
  return top.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
}
// lists clip what sticks out of them (for scrolling): while pieces swing, let them out at the sides
function dockUnclip(els) {
  const lists = new Set(els.map(e => e.closest(".list")).filter(Boolean));
  lists.forEach(l => { l.style.overflow = "visible"; l.style.clipPath = "inset(0 -4000px)"; });
  return () => lists.forEach(l => { l.style.overflow = l.style.clipPath = ""; });
}
function dockOut(els, { dur = 300, stagger = 28 } = {}) {
  dockUnclip(els); // (the screen is leaving, nothing to put back)
  stagger = Math.min(stagger, 160 / Math.max(1, els.length)); // however many pieces, all on their way within ~0.16 s
  return Promise.all(els.map((e, i) => {
    cancelTurn(e);
    return done(e.animate(dockFrames(e, { a: 0, opacity: +getComputedStyle(e).opacity }, { a: 72, opacity: 0 }), { id: "turn", duration: dur, delay: i * stagger, easing: DOCK_FOLD, fill: "forwards" }));
  }));
}
function dockIn(els, { dur = 460, delays } = {}) {
  const reclip = dockUnclip(els);
  // the picked button is normally a little bigger; during the swing that would grow from the TV's
  // left edge (riding low), so it swings in at normal size and grows from its own middle once landed
  els.forEach(e => { e.style.scale = "1"; });
  return Promise.all(els.map((e, i) => {
    cancelTurn(e);
    const o = +getComputedStyle(e).opacity; // its own brightness (dimmed words stay dim)
    const f = dockFrames(e, { a: 84, opacity: 0 }, { a: 0, opacity: o });
    f.splice(1, 0, { opacity: o, offset: 0.3 });
    return done(e.animate(f, { id: "turn", duration: dur, delay: delays ? delays[i] ?? i * 25 : Math.min(i * 26, 320), easing: DOCK_SWING, fill: "backwards" }));
  })).then(() => {
    reclip();
    els.forEach(e => { e.style.scale = ""; }); // landed: the picked button grows to its size
  });
}
// now playing's pieces in the dock's order: artist, album, cover, time, bar, song, next song, buttons
function npPieces(page) {
  const q = s => qa(page.el, s);
  return [...q(".np-artist"), ...q(".np-album"), ...q(".np-art"), ...q(".np-times"), ...q(".np-bar"), ...q(".np-title"), ...q(".np-next"), ...q(".np-ctl .b")]
    .filter(e => e.getBoundingClientRect().width > 0 || e.classList.contains("np-art"));
}
async function dockForward(cur, page) {
  await Promise.race([dockOut(dockPieces(cur)), wait(700)]);
  cur.unmount();
  stack.push(page); page.mount(); applyBg(page);
  page.el.style.visibility = "hidden";
  await wait(40); // a beat of empty screen
  page.el.style.visibility = "";
  const els = npPieces(page);
  qa(page.el, ".np-ctl").forEach(c => c.classList.remove("t"));
  const bgEls = qa(page.el, ".np-bg, .np-shade");
  bgEls.forEach(b => b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: "ease-out", fill: "backwards" }));
  await Promise.race([dockIn(els, { delays: [0, 30, 60, 110, 120, 130, 140, 160, 175, 190, 205, 220] }), wait(900)]);
}
async function dockBack(cur, prev) {
  await Promise.race([dockOut(npPieces(cur), { dur: 260, stagger: 22 }), wait(650)]);
  cur.unmount();
  prev.mount(); applyBg(prev);
  prev.el.style.visibility = "hidden";
  await wait(40);
  prev.el.style.visibility = "";
  await Promise.race([dockIn(dockPieces(prev)), wait(900)]);
}

// settings → appearance → now playing animation: "dock" swings it in like the Zune AV Dock; "zoom" is the usual
const dockOn = () => Prefs.get("npAnim") === "dock";

// replace: the new page takes the current one's place (Back then skips over it)
async function go(page, { replace = false } = {}) {
  if (busy) return;
  busy = true;
  const cur = top();
  const hero = !replace && cur && cur.hero && cur.hero(page);
  if (cur && dockOn() && page instanceof NowPlaying && !(cur instanceof NowPlaying)) {
    await dockForward(cur, page);
    if (replace) stack.splice(stack.length - 2, 1);
  } else if (hero) {
    await heroForward(cur, page, hero);
  } else {
    const keep = sameTitle(cur, page), pan = keep ? titlePanOf(cur) : null;
    if (cur) {
      await Promise.race([cur.leave(1, { skipTitle: keep }), wait(650)]);
      cur.unmount();
      if (replace) stack.pop();
    }
    stack.push(page); page.mount(); applyBg(page);
    if (keep) holdTitle(page, pan);
    await Promise.race([page.enter(1, { skipTitle: keep }), wait(180)]);
  }
  idle();
}

async function back() {
  if (busy || stack.length < 2) return;
  busy = true;
  const cur = stack.pop(), prev = top();
  const heroName = prev.heroItem && cur.heroName && prev.items && prev.items.includes(cur.heroName) ? cur.heroName : null;
  if (dockOn() && cur instanceof NowPlaying) await dockBack(cur, prev);
  else if (heroName) await heroBack(cur, prev, heroName);
  else {
    const keep = sameTitle(cur, prev), pan = keep ? titlePanOf(cur) : null;
    await Promise.race([cur.leave(-1, { skipTitle: keep }), wait(650)]); cur.unmount();
    prev.mount(); applyBg(prev);
    if (keep) holdTitle(prev, pan);
    await Promise.race([prev.enter(-1, { skipTitle: keep }), wait(180)]);
  }
  idle();
}

// Home -> section: the other menu words clear away, the chosen word grows and rises into the title.
async function heroForward(cur, page, item) {
  const ghosts = heroGhosts(item.dataset.id);
  const from = heroFrom(item);
  item.style.visibility = "hidden";
  slideOut(visibleT(cur.el).filter(e => e !== item), 1, { dist: 140, dur: 200, stagger: 18 });
  const fly = heroFly(ghosts, from, "none", true, 720);
  await wait(260);
  cur.unmount();
  stack.push(page); page.mount(); applyBg(page);
  const title = page.el.querySelector(".z");
  if (title) title.style.visibility = "hidden";
  page.enter(1, { skipTitle: true, wait: 140 });  // labels and content cascade in as the title lands
  await Promise.race([done(fly), wait(800)]);
  if (title) title.style.visibility = "";
  ghosts.forEach(g => g.remove());
}

// Section -> home: the title shrinks back down into its word in the menu.
async function heroBack(cur, prev, name) {
  const title = cur.el.querySelector(".z");
  const ghosts = heroGhosts(name, title.style.translate);
  ghosts[0].style.opacity = 0; // start showing just the capitals, exactly over the title
  title.style.visibility = "hidden";
  await Promise.race([cur.leave(-1, { skipTitle: true }), wait(400)]);
  cur.unmount();
  prev.mount(); applyBg(prev);
  const item = prev.heroItem(name);
  item.style.visibility = "hidden";
  const fly = heroFly(ghosts, "none", heroFrom(item), false, 620);
  turnIn(visibleT(prev.el).filter(e => e !== item), -1, { delay: 120 });
  await Promise.race([done(fly), wait(700)]);
  item.style.visibility = "";
  ghosts.forEach(g => g.remove());
}

// background picture behind the current screen (falls back to a generated one if it won't load)
let bgSrc = null, bgTimer = null, bgWaiting = false, bgBlend = null;
function applyBg(p) {
  const b = p.bg();
  const src = b.src || Art.wallpaper();
  if (bgBlend) { bgBlend.remove(); bgBlend = null; } // (a blend still running: this replaces it)
  $bgImg.style.transform = `translateX(${b.x || 0}px)`;
  $bgImg.parentNode.classList.toggle("drift", !!b.drift); // the picture slowly drifts and zooms (artist pages)
  clearTimeout(bgTimer); bgWaiting = false;
  // no clock over full screen playback (watching tv, music now playing)
  $stage.classList.toggle("fullplay", p instanceof LivePage || p instanceof NowPlaying || p instanceof PhotoPage);
  // live tv playing full screen behind the menus replaces the background picture
  Live.place(p);
  if (Live.active && Live.modeFor(p) !== "corner") { $bgImg.style.opacity = 0; return; }
  BgVod.place(p);
  if (BgVod.active && Live.bgMode !== "corner") { $bgImg.style.opacity = 0; return; } // a movie playing behind the menus
  if (src !== bgSrc) {
    bgSrc = src;
    $bgImg.style.opacity = 0; bgWaiting = true;
    bgTimer = setTimeout(() => {
      bgWaiting = false;
      $bgImg.onerror = () => { $bgImg.onerror = null; $bgImg.src = b.fallback || Art.wallpaper(); };
      $bgImg.classList.toggle("soft", !!b.soft); // a small cover: blurred and darkened, not stretched
      $bgImg.src = src; $bgImg.style.opacity = b.opacity;
    }, 350);
  } else {
    $bgImg.classList.toggle("soft", !!b.soft);
    $bgImg.style.opacity = b.opacity;
  }
}
// Same screen, new picture (radio: the artist's photos arriving, or taking turns): the new one fades
// in over the old one, with no dip to black in between. The picture should already be loaded.
function blendBg(p) {
  const b = p.bg(), src = b.src;
  if (!src || src === bgSrc) return;
  if (bgWaiting || bgBlend || Live.active || BgVod.active || $bgImg.style.opacity === "0") return applyBg(p);
  const over = $bgImg.cloneNode(false);
  over.removeAttribute("id"); over.onerror = null;
  over.classList.toggle("soft", !!b.soft);
  over.style.opacity = 0; over.src = src;
  $bgImg.after(over); bgBlend = over; bgSrc = src;
  void over.offsetWidth; // commit the starting opacity so the fade runs
  over.style.opacity = b.opacity;
  setTimeout(() => {
    if (bgBlend !== over) return;
    // the main picture takes the new one, then the copy on top goes
    $bgImg.onerror = () => { $bgImg.onerror = null; $bgImg.src = b.fallback || Art.wallpaper(); };
    $bgImg.classList.toggle("soft", !!b.soft);
    $bgImg.src = src;
    const done = () => { if (bgBlend === over) { over.remove(); bgBlend = null; } };
    $bgImg.decode().then(done, done);
  }, 900);
}

/* ============ lists & grids ============ */
function bounce(inner, y, d) {
  inner.animate([
    { transform: `translateY(${y}px)` },
    { transform: `translateY(${y - d * 18}px)` },
    { transform: `translateY(${y}px)` },
  ], { duration: 300, easing: "ease-out" });
}

function List({ items, itemH, height = 760, row, focus = 0 }) {
  const view = el("div", "list"); view.style.height = height + "px";
  const inner = el("div", "list-inner"); view.append(inner);
  const rows = items.map((it, i) => {
    const r = row(it, i);
    r.classList.add("row", "t"); r.style.height = itemH + "px";
    inner.append(r); return r;
  });
  const vis = Math.max(1, Math.floor(height / itemH));
  let f = clamp(focus, 0, Math.max(0, items.length - 1)), sc = 0;
  const y = () => -sc * itemH;
  function paint(anim) {
    rows.forEach((r, i) => r.classList.toggle("focus", i === f));
    if (f < sc + 1) sc = f - 1;
    if (f > sc + vis - 2) sc = f - vis + 2;
    sc = clamp(sc, 0, Math.max(0, items.length - vis));
    inner.style.transition = anim ? `transform 340ms ${EASE}` : "none";
    inner.style.transform = `translateY(${y()}px)`;
  }
  paint(false);
  return {
    el: view,
    get index() { return f; },
    get atTop() { return f === 0; },
    get item() { return items[f]; },
    move(d) {
      const n = clamp(f + d, 0, items.length - 1);
      if (n === f) return bounce(inner, y(), d);
      f = n; paint(true);
    },
    moveX() { return false; },
  };
}

// Grid of covers or posters, like the Zune HD albums view. (It still copes with "letter" tiles, but none are added any more.)
function Grid({ items, cols, w, h, gap = 24, height = 760, cell, focus = 0 }) {
  const view = el("div", "list grid"); view.style.height = height + "px"; // ("grid": room around the edges for the picked cover's border)
  const inner = el("div", "grid-inner"); view.append(inner);
  const stepX = w + gap, stepY = h + gap;
  const tiles = items.map((it, i) => {
    const t = cell(it, i);
    t.classList.add("tile", "t");
    Object.assign(t.style, { left: (i % cols) * stepX + "px", top: Math.floor(i / cols) * stepY + "px", width: w + "px", height: h + "px" });
    inner.append(t); return t;
  });
  const visRows = Math.max(1, Math.floor((height + gap) / stepY));
  const rowsTotal = Math.ceil(items.length / cols);
  let f = clamp(focus, 0, Math.max(0, items.length - 1)), sc = 0;
  while (items[f] && items[f].letter && f < items.length - 1) f++; // start on a cover, not a letter tile
  const y = () => -sc * stepY;
  function paint(anim) {
    tiles.forEach((t, i) => t.classList.toggle("focus", i === f));
    const r = Math.floor(f / cols);
    if (r < sc) sc = r;
    if (r > sc + visRows - 1) sc = r - visRows + 1;
    sc = clamp(sc, 0, Math.max(0, rowsTotal - visRows));
    inner.style.transition = anim ? `transform 380ms ${EASE}` : "none";
    inner.style.transform = `translateY(${y()}px)`;
  }
  paint(false);
  return {
    el: view,
    get index() { return f; },
    get atTop() { return Math.floor(f / cols) === 0; }, // on the first row of covers
    get item() { return items[f]; },
    move(d) { // up/down = one row (letter tiles are skipped)
      let n = f + d * cols;
      if (n > items.length - 1 && Math.floor(f / cols) < rowsTotal - 1) n = items.length - 1;
      if (n < 0 || n > items.length - 1) return bounce(inner, y(), d);
      if (items[n].letter) n = (n + 1 < items.length && Math.floor((n + 1) / cols) === Math.floor(n / cols)) ? n + 1 : n - 1;
      f = n; paint(true);
    },
    moveX(d) { // returns false at the row edge so left/right can switch sections instead
      const row = Math.floor(f / cols);
      let n = f + d;
      while (n >= 0 && n < items.length && items[n].letter) n += d;
      if (n < 0 || n >= items.length || Math.floor(n / cols) !== row) return false;
      f = n; paint(true); return true;
    },
  };
}

// placeholder "list" holding a message (loading…, nothing here, an error)
function Message(text, height = 760) {
  const view = el("div", "list"); view.style.height = height + "px";
  view.append(el("div", "list-msg t", esc(text)));
  return { el: view, index: 0, item: null, atTop: true, move() {}, moveX() { return false; }, message: true };
}

// Zune HD text style: song / album / movie titles keep their normal capitalization;
// artist and album names are bold caps; small info lines are small caps (via CSS).
const ROW = {
  station: st => el("div", "r-album", `${coverTag(st)}<div class="tx"><div class="t1 caps">${esc(st.title)}</div><div class="t2 sc">${esc(st.desc || "")}</div></div>`),
  artist: a => el("div", "r-artist", `<span class="pb">${ICON.play}</span><div class="cap">${esc(a.name)}</div>`),
  album: al => el("div", "r-album", `${coverTag(al)}<div class="tx"><div class="t1 caps">${esc(al.title)}</div><div class="t2 sc">${esc(al.artist.name)}</div></div>`),
  albumYear: al => el("div", "r-album", `${coverTag(al)}<div class="tx"><div class="t1 caps">${esc(al.title)}</div><div class="t2 sc">${[al.year, al.count ? al.count + " songs" : al.tracks ? al.tracks.length + " songs" : ""].filter(Boolean).join(" · ")}</div></div>`),
  song: s => el("div", "r-song", `<div class="tx"><div class="t1">${esc(s.title)}</div><div class="t2 sc">${esc(s.artist.name)} · ${esc(s.album.title)}</div></div>`),
  track: s => el("div", "r-track" + (Player.track && Player.track.id === s.id ? " playing" : ""), `<span class="t1">${esc(s.title)}</span><span class="dur">${s.dur ? fmt(s.dur) : ""}</span>`),
  playlist: p => el("div", "r-playlist", `<div class="tx"><div class="t1">${esc(p.name)}</div><div class="t2 sc">${p.count || (p.tracks ? p.tracks.length : 0)} songs</div></div>`),
  genre: g => el("div", "r-genre", `<span class="pb">${ICON.play}</span><div class="cap">${esc(g.name)}</div>`),
  episode: e => el("div", "r-episode", `${e.thumb ? imgTag(e.thumb, "ep") : `<div class="ep none"></div>`}<div class="tx"><div class="t1"><span class="eno">${e.episode || ""}</span>${esc(e.title)}</div><div class="t2 sc">${[e.runtime ? fmtLong(e.runtime) : "", e.played ? "watched" : e.resume ? "in progress" : ""].filter(Boolean).join(" · ")}</div></div>`),
};
const CELL = {
  album: al => al.letter
    ? el("div", "letter", `<span>${esc(al.letter)}</span>`)
    : el("div", "", `${coverTag(al)}<div class="tcap"><b>${esc(al.title)}</b><span>${esc(al.artist.name)}</span></div>`),
  poster: v => v.letter
    ? el("div", "letter", `<span>${esc(v.letter)}</span>`)
    : el("div", "poster", `${v.img ? imgTag(v.img) : `<div class="noimg">${esc(v.title)}</div>`}<div class="tcap"><b>${esc(v.type === "Episode" && v.seriesName ? v.seriesName : v.title)}</b><span>${esc(v.type === "Episode" ? `S${v.season || "?"} E${v.episode || "?"} · ${v.title}` : v.year)}</span></div>`),
  station: st => el("div", "", `${coverTag(st)}<div class="tcap"><b>${esc(st.title)}</b><span>${esc(st.desc)}</span></div>`),
  // round photo with the name underneath, like Emby's artist view
  artist: a => {
    const initials = (a.name.match(/\b\w/g) || ["?"]).slice(0, 2).join("").toUpperCase();
    const noPic = `<div class="ini" style="background:hsl(${a.hue || 0},35%,22%)">${esc(initials)}</div>`;
    const t = el("div", "artist", `<div class="circ">${a.img ? imgTag(a.img) : noPic}</div><div class="nm">${esc(a.name)}</div>`);
    const im = t.querySelector("img");
    if (im) im.addEventListener("error", () => { im.outerHTML = noPic; }, { once: true }); // no photo in emby: initials
    return t;
  },
};

// a person in a cast list: the artist's round photo, with the part they played underneath
CELL.person = p => {
  const t = CELL.artist(p);
  t.append(el("div", "rl", esc(p.role || "")));
  return t;
};

const listView = (itemH, row) => (items, focus) => List({ items, itemH, row, focus });
const albumGrid = (items, focus) => Grid({ items, cols: 7, w: 220, h: 220, cell: CELL.album, focus });
const artistGrid = (items, focus) => Grid({ items: items.filter(a => !a.letter), cols: 7, w: 220, h: 276, gap: 30, cell: CELL.artist, focus });
// home videos & pictures: folders, videos and photos (folders carry a folder mark; videos their length)
const homeDate = x => x.when ? new Date(x.when).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }).toLowerCase() : "";
const FOLDER_ICON = `<svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
CELL.media = x => {
  const pic = x.kind === "folder"
    ? (x.img ? imgTag(x.img) : "") + `<span class="fmark">${FOLDER_ICON}</span>`
    : x.thumb || x.img ? imgTag(x.kind === "photo" ? x.img : x.thumb || x.img) : `<span class="noimg"></span>`;
  const sub = x.kind === "folder" ? (x.count ? `${x.count} item${x.count === 1 ? "" : "s"}` : "folder")
    : [homeDate(x), x.kind === "video" && x.runtime ? fmtLong(x.runtime) : ""].filter(Boolean).join(" · ");
  return el("div", `media ${x.kind}`, `<div class="pic">${pic}${x.kind === "video" && x.runtime ? `<span class="len">${fmt(x.runtime)}</span>` : ""}</div><div class="mcap"><b>${esc(x.title)}</b><span>${esc(sub)}</span></div>`);
};
ROW.media = x => el("div", `r-media ${x.kind}`, `<div class="pic">${x.kind === "folder" ? FOLDER_ICON : x.thumb || x.img ? imgTag(x.kind === "photo" ? x.img : x.thumb || x.img) : ""}</div><div class="tx"><div class="t1">${esc(x.title)}</div><div class="t2 sc">${
  esc(x.kind === "folder" ? (x.count ? `folder · ${x.count} items` : "folder") : [homeDate(x), x.kind === "video" && x.runtime ? fmtLong(x.runtime) : "", x.played ? "watched" : x.resume > 60 ? "in progress" : ""].filter(Boolean).join(" · "))}</div></div>`);
ROW.video = v => el("div", "r-video", `${v.img ? imgTag(v.img, "pt") : `<div class="pt none"></div>`}<div class="tx"><div class="t1">${esc(v.type === "Episode" && v.seriesName ? v.seriesName : v.title)}</div><div class="t2 sc">${
  esc([v.type === "Episode" ? `s${v.season || "?"} e${v.episode || "?"} · ${v.title}` : v.year, v.runtime ? fmtLong(v.runtime) : "", v.rating, v.score ? v.score + " ★" : ""].filter(Boolean).join(" · "))}</div></div>`);

// tv guide → movies / shows / sports: one upcoming airing (the soonest), with when and where it's on
function airText(p) {
  const now = Date.now();
  if (p.start <= now && p.end > now) return "on now";
  const d = new Date(p.start), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((d - today) / 864e5);
  const day = days <= 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? d.toLocaleDateString([], { weekday: "short" }).toLowerCase()
    : d.toLocaleDateString([], { month: "short", day: "numeric" }).toLowerCase();
  return `${day} ${clock12(p.start)}`;
}
const progWhere = p => [airText(p), p.ch && p.ch.name, p.airings > 1 ? `+${p.airings - 1} more` : ""].filter(Boolean).join(" · ");
const progRec = p => !!(p.timerId || p.anyRec || p.seriesTimerId);
CELL.program = p => el("div", "poster", `${p.img ? imgTag(p.img) : `<div class="noimg">${esc(p.title)}</div>`}${progRec(p) ? `<span class="recmark"></span>` : ""}` +
  `<div class="tcap"><b>${esc(progTitle(p))}</b><span>${esc(progWhere(p))}</span></div>`);
ROW.program = p => el("div", "r-detail r-program", `<div class="tx"><div class="t1">${esc(progTitle(p))}${progRec(p) ? ` <span class="recdot">●</span>` : ""}</div>` +
  `<div class="t2 sc">${esc([progWhere(p), !p.isMovie && p.ep ? p.ep : "", p.isNew ? "new" : ""].filter(Boolean).join(" · "))}</div></div>`);

/* ============ view options: the hidden side menu (like the old hub) ============
   On pages that have it (movies, tv shows, music albums & artists), pressing ← at the left edge of
   the covers slides a menu in from the left: layout (posters / list), size (small / medium / large)
   and sort order. ↑ ↓ move, Enter picks (the covers rearrange right away), → or Back closes it.
   Choices are remembered per area. */
const VIEW_SIZES = [["s", "small"], ["m", "medium"], ["l", "large"]];
const VIEW_KINDS = {
  video: {
    layouts: [["posters", "posters"], ["list", "list"], ["showcase", "showcase"], ["wall", "wall"], ["details", "list + details"], ["carousel", "carousel"]],
    sorts: [["title:asc", "title a–z"], ["title:desc", "title z–a"], ["year:desc", "year · newest"], ["year:asc", "year · oldest"], ["added:desc", "recently added"], ["score:desc", "top rated"]],
    grid: { s: { cols: 10, w: 146, h: 219, gap: 20 }, m: { cols: 8, w: 186, h: 279, gap: 22 }, l: { cols: 6, w: 250, h: 375, gap: 28 } },
    cell: CELL.poster, row: ROW.video, rowH: { s: 100, m: 140, l: 190 },
  },
  album: {
    layouts: [["posters", "covers"], ["list", "list"]],
    sorts: [["title:asc", "title a–z"], ["title:desc", "title z–a"], ["artist:asc", "artist a–z"], ["year:desc", "year · newest"], ["year:asc", "year · oldest"]],
    grid: { s: { cols: 9, w: 166, h: 166, gap: 22 }, m: { cols: 7, w: 220, h: 220, gap: 24 }, l: { cols: 5, w: 300, h: 300, gap: 30 } },
    cell: CELL.album, row: ROW.album, rowH: { s: 110, m: 140, l: 180 },
  },
  artist: {
    layouts: [["posters", "pictures"], ["list", "list"]],
    sorts: [["title:asc", "name a–z"], ["title:desc", "name z–a"]],
    grid: { s: { cols: 9, w: 160, h: 214, gap: 24 }, m: { cols: 7, w: 220, h: 276, gap: 30 }, l: { cols: 5, w: 290, h: 348, gap: 40 } },
    cell: CELL.artist, row: ROW.artist, rowH: { s: 80, m: 96, l: 120 },
  },
  station: {
    layouts: [["posters", "covers"], ["list", "list"]],
    sorts: [["default", "network order"], ["title:asc", "name a–z"], ["title:desc", "name z–a"]],
    grid: { s: { cols: 9, w: 166, h: 166, gap: 22 }, m: { cols: 7, w: 220, h: 220, gap: 24 }, l: { cols: 5, w: 300, h: 300, gap: 30 } },
    cell: CELL.station, row: st => ROW.station(st), rowH: { s: 100, m: 130, l: 170 },
  },
  // tv guide tabs
  tvmovie: {
    layouts: [["posters", "posters"], ["list", "list"]],
    sorts: [["start:asc", "air date · soonest"], ["year:asc", "year · oldest"], ["year:desc", "year · newest"], ["title:asc", "title a–z"], ["title:desc", "title z–a"]],
    grid: { s: { cols: 10, w: 146, h: 219, gap: 20 }, m: { cols: 8, w: 186, h: 279, gap: 22 }, l: { cols: 6, w: 250, h: 375, gap: 28 } },
    cell: CELL.program, row: ROW.program, rowH: { s: 96, m: 110, l: 140 },
  },
  tvshow: {
    layouts: [["posters", "posters"], ["list", "list"]],
    sorts: [["title:asc", "title a–z"], ["start:asc", "air date · soonest"], ["title:desc", "title z–a"]],
    grid: { s: { cols: 10, w: 146, h: 219, gap: 20 }, m: { cols: 8, w: 186, h: 279, gap: 22 }, l: { cols: 6, w: 250, h: 375, gap: 28 } },
    cell: CELL.program, row: ROW.program, rowH: { s: 96, m: 110, l: 140 },
  },
  tvsport: {
    layouts: [["list", "list"], ["posters", "posters"]],
    sorts: [["start:asc", "air date · soonest"], ["title:asc", "title a–z"]],
    grid: { s: { cols: 10, w: 146, h: 219, gap: 20 }, m: { cols: 8, w: 186, h: 279, gap: 22 }, l: { cols: 6, w: 250, h: 375, gap: 28 } },
    cell: CELL.program, row: ROW.program, rowH: { s: 96, m: 110, l: 140 },
  },
  homevideo: {
    layouts: [["posters", "thumbnails"], ["list", "list"]],
    sorts: [["date:desc", "newest first"], ["date:asc", "oldest first"], ["title:asc", "name a–z"], ["title:desc", "name z–a"], ["added:desc", "recently added"]],
    grid: { s: { cols: 6, w: 262, h: 202, gap: 22 }, m: { cols: 5, w: 318, h: 236, gap: 24 }, l: { cols: 3, w: 540, h: 362, gap: 30 } },
    cell: CELL.media, row: ROW.media, rowH: { s: 96, m: 130, l: 180 },
  },
  photo: {
    layouts: [["posters", "grid"], ["list", "list"]],
    sorts: [["date:desc", "newest first"], ["date:asc", "oldest first"], ["title:asc", "name a–z"], ["title:desc", "name z–a"], ["added:desc", "recently added"]],
    grid: { s: { cols: 9, w: 172, h: 172, gap: 14 }, m: { cols: 7, w: 222, h: 222, gap: 18 }, l: { cols: 5, w: 316, h: 316, gap: 22 } },
    cell: CELL.media, row: ROW.media, rowH: { s: 96, m: 130, l: 180 },
  },
};
const Views = {
  all() { try { return JSON.parse(localStorage.getItem("mc.views") || "{}"); } catch { return {}; } },
  // (the starting sort is the first one offered: title for movies, newest first for home videos & pictures)
  get(key, kind) { return { mode: kind ? VIEW_KINDS[kind].layouts[0][0] : "posters", size: "m", sort: kind ? VIEW_KINDS[kind].sorts[0][0] : "title:asc", ...(this.all()[key] || {}) }; },
  set(key, v) { const a = this.all(); a[key] = v; try { localStorage.setItem("mc.views", JSON.stringify(a)); } catch {} },
  // the items in the chosen order (only where sorting makes sense: not "recent" or "continue")
  sorted(items, views, v) {
    if (!views.sort || v.sort === "default") return items; // ("default": the order it came in, e.g. a radio network's own)
    const [field, dir] = v.sort.split(":"), m = dir === "desc" ? -1 : 1;
    const name = x => String(x.sortName || x.title || x.name || "").toLowerCase();
    const val = x => field === "start" ? x.start || 0 : field === "year" ? Number(x.year) || 0 : field === "added" ? Date.parse(x.added || "") || 0
      : field === "date" ? x.when || Date.parse(x.added || "") || 0
      : field === "score" ? x.score || 0 : field === "artist" ? String((x.artist && x.artist.name) || "").toLowerCase() : name(x);
    return items.slice().sort((a, b) => {
      if (views.folders && a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1; // folders stay first
      const A = val(a), B = val(b);
      if (field === "year" && (!A || !B) && A !== B) return A ? -1 : 1; // no year known: at the end, either way round
      const c = typeof A === "string" ? A.localeCompare(B) : A - B;
      return c * m || name(a).localeCompare(name(b));
    });
  },
  make(kind, v, items, focus) {
    const K = VIEW_KINDS[kind];
    if (!K.layouts.some(([m]) => m === v.mode)) v = { ...v, mode: "posters" }; // a layout this area doesn't offer
    if (v.mode === "list") return List({ items, itemH: K.rowH[v.size] || K.rowH.m, row: K.row, focus });
    const special = { showcase: Showcase, wall: Wall, details: Details, carousel: Carousel }[v.mode];
    if (special) return special({ items, size: v.size, focus });
    const g = K.grid[v.size] || K.grid.m;
    const L = Grid({ items, ...g, cell: K.cell, focus });
    L.el.classList.add("sz-" + v.size, "k-" + kind);
    return L;
  },
};
const posterGrid = (items, focus) => Grid({ items, cols: 8, w: 186, h: 279, gap: 22, cell: CELL.poster, focus });

/* ============ more ways to see movies & tv (the side menu's layout choices) ============
   Each returns the same little interface as List and Grid (el, index, item, atTop, move, moveX).
   Showcase, details and carousel also offer bg(): the picked title's backdrop fills the screen
   behind them, and onFocus (set by the page) is called whenever the pick changes. */
const BODY_W = 1728; // the width the views have (1920 minus the margins)
// title · year · length · rating for the info beside or above the pictures
function videoTitle(v) { return v.type === "Episode" && v.seriesName ? v.seriesName : v.title; }
function videoMeta(v) {
  return [v.type === "Episode" ? `s${v.season || "?"} e${v.episode || "?"} · ${v.title}` : v.type === "Series" ? "" : v.year,
    v.runtime ? fmtLong(v.runtime) : "", v.rating, v.score ? `${v.score} ★` : "",
    v.played ? "watched" : v.resume > 60 ? "in progress" : ""].filter(Boolean).join(" · ");
}
function videoInfoHtml(v) {
  if (!v) return "";
  const genres = (v.genres || []).slice(0, 3).join(" · ").toLowerCase();
  return `<div class="vi-t">${esc(videoTitle(v))}</div><div class="vi-m sc">${esc(videoMeta(v))}</div>` +
    `<div class="vi-o">${esc(v.overview || "")}</div>${genres ? `<div class="vi-g">${esc(genres)}</div>` : ""}`;
}
const backdropOf = v => (v && (v.backdrop || v.img)) ? { src: v.backdrop || v.img, opacity: 0.6 } : null;

// Showcase: the backdrop fills the screen, the title and story sit on top, one row of posters along the bottom.
function Showcase({ items, size, focus = 0, height = 760 }) {
  const P = { s: { w: 150, h: 225, gap: 20 }, m: { w: 186, h: 279, gap: 24 }, l: { w: 230, h: 345, gap: 28 } }[size] || { w: 186, h: 279, gap: 24 };
  const view = el("div", "list showcase sz-" + size); view.style.height = height + "px";
  const info = el("div", "sc-info t");
  const strip = el("div", "sc-strip"); strip.style.height = P.h + 44 + "px";
  const inner = el("div", "grid-inner"); strip.append(inner);
  view.append(info, strip);
  const step = P.w + P.gap, vis = Math.max(1, Math.floor((BODY_W - 28 + P.gap) / step));
  const tiles = items.map((it, i) => {
    const t = CELL.poster(it); t.classList.add("tile", "t");
    Object.assign(t.style, { left: 14 + i * step + "px", top: "22px", width: P.w + "px", height: P.h + "px" });
    inner.append(t); return t;
  });
  let f = clamp(focus, 0, Math.max(0, items.length - 1)), sc = 0;
  function paint(anim) {
    tiles.forEach((t, i) => t.classList.toggle("focus", i === f));
    if (f < sc + 1) sc = f - 1;
    if (f > sc + vis - 2) sc = f - vis + 2;
    sc = clamp(sc, 0, Math.max(0, items.length - vis));
    inner.style.transition = anim ? `transform 380ms ${EASE}` : "none";
    inner.style.transform = `translateX(${-sc * step}px)`;
    info.innerHTML = videoInfoHtml(items[f]);
  }
  paint(false);
  const api = {
    el: view,
    get index() { return f; }, get atTop() { return true; }, get item() { return items[f]; },
    move() {}, // one row: up goes to the section names, down does nothing
    moveX(d) {
      const n = f + d;
      if (n < 0 || n >= items.length) return false;
      f = n; paint(true); if (api.onFocus) api.onFocus(); return true;
    },
    bg() { return backdropOf(items[f]); },
  };
  return api;
}

// Wall: wide scene pictures in a grid (the backdrop, or the episode still, instead of the tall poster).
CELL.wall = v => el("div", "wall", `${v.backdrop || v.thumb || v.img ? imgTag(v.backdrop || v.thumb || v.img) : `<div class="noimg"></div>`}` +
  `<div class="tcap"><b>${esc(videoTitle(v))}</b><span>${esc(videoMeta(v))}</span></div>`);
function Wall({ items, size, focus = 0 }) {
  const g = { s: { cols: 4, w: 408, h: 230, gap: 24 }, m: { cols: 3, w: 544, h: 306, gap: 28 }, l: { cols: 2, w: 828, h: 466, gap: 36 } }[size] || { cols: 3, w: 544, h: 306, gap: 28 };
  const L = Grid({ items, ...g, cell: CELL.wall, focus });
  L.el.classList.add("sz-" + size, "k-wall");
  return L;
}

// List + details: titles down the left, the picked one's poster and story on the right.
ROW.detail = v => el("div", "r-detail", `<div class="tx"><div class="t1">${esc(videoTitle(v))}</div><div class="t2 sc">${esc(videoMeta(v))}</div></div>`);
function Details({ items, size, focus = 0, height = 760 }) {
  const H = { s: 72, m: 96, l: 124 }[size] || 96;
  const L = List({ items, itemH: H, row: ROW.detail, focus, height });
  L.el.classList.add("dt-list");
  const view = el("div", "list details sz-" + size); view.style.height = height + "px";
  const side = el("div", "dt-side t");
  view.append(L.el, side);
  const show = () => {
    const v = L.item;
    side.innerHTML = v ? `${v.img ? imgTag(v.img, "dt-pic") : `<div class="dt-pic none"></div>`}<div class="dt-txt">${videoInfoHtml(v)}</div>` : "";
  };
  show();
  const api = {
    el: view,
    get index() { return L.index; }, get atTop() { return L.atTop; }, get item() { return L.item; },
    move(d) { const before = L.index; L.move(d); if (L.index !== before) { show(); if (api.onFocus) api.onFocus(); } },
    moveX() { return false; },
    bg() { return backdropOf(L.item); },
  };
  return api;
}

// Carousel: one big poster in the middle; the ones beside it shrink and fade away to either side.
function Carousel({ items, size, focus = 0, height = 760 }) {
  const P = { s: { w: 236, h: 354 }, m: { w: 286, h: 429 }, l: { w: 330, h: 495 } }[size] || { w: 286, h: 429 };
  const view = el("div", "list carousel sz-" + size); view.style.height = height + "px";
  const ring = el("div", "cr-ring"), cap = el("div", "cr-cap t");
  view.append(ring, cap);
  const x0 = (BODY_W - P.w) / 2;
  const tiles = items.map(it => {
    const t = CELL.poster(it); t.classList.add("tile", "t");
    Object.assign(t.style, { left: x0 + "px", top: "16px", width: P.w + "px", height: P.h + "px" });
    ring.append(t); return t;
  });
  cap.style.top = P.h + 64 + "px";
  let f = clamp(focus, 0, Math.max(0, items.length - 1));
  function paint(anim) {
    tiles.forEach((t, i) => {
      const o = i - f, a = Math.abs(o);
      if (a > 6) { t.style.visibility = "hidden"; t.style.transition = "none"; t.style.transform = `translateX(${Math.sign(o) * BODY_W}px) scale(.4)`; return; }
      const x = a === 0 ? 0 : Math.sign(o) * (P.w * 0.78 + (a - 1) * P.w * 0.5);
      t.style.visibility = "";
      t.style.transition = anim ? `transform 420ms ${EASE}, opacity 420ms` : "none";
      t.style.transform = `translateX(${x}px) scale(${1 - Math.min(a, 4) * 0.16})`;
      t.style.opacity = String(1 - Math.min(a, 5) * 0.17);
      t.style.zIndex = String(20 - a);
      t.classList.toggle("focus", a === 0);
    });
    const v = items[f];
    cap.innerHTML = v ? `<div class="vi-t">${esc(videoTitle(v))}</div><div class="vi-m sc">${esc(videoMeta(v))}</div>` : "";
  }
  paint(false);
  const api = {
    el: view,
    get index() { return f; }, get atTop() { return true; }, get item() { return items[f]; },
    move() {},
    moveX(d) {
      const n = f + d;
      if (n < 0 || n >= items.length) return false;
      f = n; paint(true); if (api.onFocus) api.onFocus(); return true;
    },
    bg() { return backdropOf(items[f]); },
  };
  return api;
}

function playAndShow(tracks, i) {
  if (!tracks || !tracks[i]) return;
  Player.play(tracks, i);
  go(new NowPlaying());
}

/* ============ home ============ */
// Hub menu: order and which items show are set in settings → hub menu. Settings always stays last.
const MENU_ALL = ["music", "movies", "tv shows", "home videos", "tv guide", "recordings", "radio", "youtube", "pictures"];
// how each menu word is written (the ids stay lowercase internally; the menu shows them in capitals)
const MENU_LABEL = { music: "Music", movies: "Movies", "tv shows": "TV Shows", "tv guide": "TV Guide", radio: "Radio", youtube: "YouTube", "home videos": "Home Videos", recordings: "Recordings", pictures: "Pictures", settings: "Settings" };
// saved as [[id, shown], …]; items added in later versions are appended so they still appear
function menuLayout() {
  const saved = (Prefs.get("menu") || []).filter(([id]) => MENU_ALL.includes(id));
  MENU_ALL.forEach(id => { if (!saved.some(([s]) => s === id)) saved.push([id, true]); });
  return saved;
}
const menuItems = () => menuLayout().filter(([, on]) => on).map(([id]) => id).concat("settings");
const quick = { key: null, rows: null, loading: null }; // live quickplay rows from Emby

function loadQuickplay() {
  const key = Emby.connected ? Emby.state.server + Emby.state.userId : "sample";
  if (quick.key === key && (quick.rows || quick.loading)) return quick.loading || Promise.resolve();
  quick.key = key; quick.rows = null;
  if (!Emby.connected) { quick.rows = [["history", LIB.history], ["new", LIB.newest]]; return Promise.resolve(); }
  quick.loading = Promise.all([
    Emby.resume().catch(() => []),
    Emby.newAlbums(8).catch(() => []),
    Emby.newMovies(8).catch(() => []),
    Emby.recordings().then(l => l.filter(r => !r.played)).catch(() => []),
  ]).then(([resume, albums, movies, recs]) => {
    quick.rows = [["continue", resume], ["new recordings", recs], ["new music", albums], ["new movies", movies]].filter(r => r[1].length);
    quick.loading = null;
  });
  return quick.loading;
}
function openItem(x) {
  if (!x) return;
  if (x.rec) return playRecording(x);
  if (x.artist && !x.type) return go(new AlbumPage(x));
  if (x.type === "Series") return openShow(x);
  return go(new VideoPage(x));
}

class Home extends Page {
  constructor() { super(); this.sec = 0; this.mid = "music"; this.qr = 0; this.qc = 0; }
  render() {
    const root = el("div", "home");
    this.root = root;
    // quickplay (History / New) waits fully off screen to the left; ← brings it in while the menu
    // shrinks, slides right and dims (the "qp" class on .home drives both, see styles.css)
    this.pano = el("div", "home-pano"); root.append(this.pano);

    const menu = el("div", "home-menu"); this.pano.append(menu);
    // (what's playing is reached with Back / Esc from here, so the menu itself stays plain)
    const menuIds = menuItems();
    this.items = [...menuIds];
    if (!this.items.includes(this.mid)) this.mid = menuIds[0];
    this.menuEls = menuIds.map(id => {
      const e = el("div", "hm-item t", esc(MENU_LABEL[id] || id));
      e.dataset.id = id; menu.append(e); return e;
    });

    this.qp = el("div", "quickplay"); this.pano.append(this.qp);
    this.buildQuickplay();
    this.menuScroll = undefined; // a fresh menu starts already scrolled to the picked word (no glide)
    this.paint();
    return root;
  }
  buildQuickplay() {
    const qp = this.qp;
    qp.innerHTML = "";
    const title = s => s.replace(/\b\w/g, c => c.toUpperCase()); // "new music" -> "New Music", like "Pins" / "History"
    this.qpLabels = [];
    this.qpScroll = 0; qp.style.translate = "";
    this.rows = (quick.rows || []).map(([label, list]) => {
      const lab = el("div", "qp-label t", esc(title(label))); qp.append(lab); this.qpLabels.push(lab);
      const row = el("div", "qp-row"); qp.append(row);
      return list.slice(0, 5).map(x => {
        const name = x.rec ? x.title : x.type === "Episode" && x.seriesName ? x.seriesName : x.title;
        const sub = x.rec ? (x.recording ? "recording now" : x.ep || x.channel) : x.artist && !x.type ? x.artist.name : x.type === "Episode" ? `s${x.season || "?"} e${x.episode || "?"}` : x.year;
        const t = el("div", "qp-tile t", `${x.type ? imgTag(x.thumb || x.img || cover(x)) : coverTag(x)}<div class="cap">${esc(lower(name))}<span>${esc(lower(sub))}</span></div>`);
        t.item = x; row.append(t); return t;
      });
    });
    if (!quick.rows) qp.append(el("div", "qp-label t", "Loading…"));
    if (this.sec === 1 && !this.rows.length) this.sec = 0;
    this.qr = clamp(this.qr, 0, Math.max(0, this.rows.length - 1));
    if (this.rows[this.qr]) this.qc = clamp(this.qc, 0, this.rows[this.qr].length - 1);
  }
  mounted() {
    if (!quick.rows) loadQuickplay().then(() => {
      if (!this.el || !quick.rows) return;
      this.buildQuickplay(); this.paint();
      slideIn(visibleT(this.qp), 1, { dist: 120, stagger: 30 });
    });
  }
  paint() {
    this.menuEls.forEach(e => e.classList.toggle("focus", this.sec === 0 && e.dataset.id === this.mid));
    this.rows.flat().forEach(t => t.classList.remove("focus"));
    if (this.sec === 1 && this.rows[this.qr]) this.rows[this.qr][this.qc].classList.add("focus");
    this.root.classList.toggle("qp", this.sec === 1);
    this.scrollMenu();
    this.scrollQuickplay();
  }
  // More shelves than fit (continue, new recordings, new music, new movies…)? The shelves glide up / down
  // so the picked one, with its caption under the covers, stays on screen. Two shelves never move.
  scrollQuickplay() {
    const lab = this.sec === 1 && this.qpLabels && this.qpLabels[this.qr];
    if (!lab) return;
    const top = lab.offsetTop, bottom = top + lab.offsetHeight + 12 + 170 + 90; // label, covers, caption
    const view = 1080 - 40 - 30, total = this.qp.offsetHeight;
    let sc = this.qpScroll || 0;
    if (bottom > sc + view) sc = bottom - view;
    if (top - 16 < sc) sc = top - 16;
    sc = clamp(sc, 0, Math.max(0, total - view));
    this.qpScroll = sc;
    this.qp.style.translate = `0 ${-sc}px`;
  }
  // Too many items for the screen? The menu glides up / down so the picked word stays in view, with
  // the next one peeking below it (Zune HD style, no scroll bar). Short menus never move.
  scrollMenu() {
    const menu = this.menuEls[0] && this.menuEls[0].parentNode; if (!menu) return;
    const rowH = 114, view = 860, n = this.menuEls.length, i = Math.max(0, this.menuEls.findIndex(e => e.dataset.id === this.mid));
    const max = Math.max(0, n * rowH - view);
    let sc = this.menuScroll || 0;
    if ((i + 2) * rowH > sc + view) sc = (i + 2) * rowH - view; // keep one more below
    if ((i - 1) * rowH < sc) sc = (i - 1) * rowH;               // …and one more above
    sc = clamp(sc, 0, max);
    const first = this.menuScroll === undefined;
    this.menuScroll = sc;
    if (first) { menu.style.transition = "none"; menu.style.translate = `0 ${-sc}px`; void menu.offsetWidth; menu.style.transition = ""; }
    else menu.style.translate = `0 ${-sc}px`;
  }
  setSec(s) {
    this.sec = s;
    if (s === 1 && this.rows[this.qr]) this.qc = this.rows[this.qr].length - 1; // arrive on the tile nearest the menu
    applyBg(this); this.paint();
  }
  bg() {
    const t = Live.active ? null : Player.track; // with tv on, the artist backdrop of paused music would be stale
    return { src: t ? artistPhoto(t.artist) : Art.wallpaper(), fallback: t ? Art.photo(t.artist.name, t.artist.hue) : null, opacity: 0.9, x: -280 + this.sec * 280, soft: softArtist(t) };
  }
  // menu word to grow into the next page's title
  hero(page) { return this.sec === 0 && page.heroName === this.mid ? this.heroItem(this.mid) : null; }
  heroItem(name) { return this.menuEls.find(e => e.dataset.id === name); }
  key(k) {
    // Back / Esc on the main menu: go full screen to whatever is playing (live tv first, then music)
    if (k === "back") {
      if (this.sec === 1) { this.setSec(0); return true; } // from quickplay, back to the menu first
      if (BgVod.active) { go(BgVod.page); return true; } // a movie playing behind the menus
      if (Live.active) { go(new LivePage(Live.guide, Live.i)); return true; }
      if (Player.track) { go(new NowPlaying()); return true; }
      return false;
    }
    if (this.sec === 0) {
      const i = this.items.indexOf(this.mid);
      if (k === "up" || k === "down") { this.mid = this.items[clamp(i + (k === "up" ? -1 : 1), 0, this.items.length - 1)]; this.paint(); return true; }
      if (k === "left") { if (this.rows.length) this.setSec(1); return true; }
      if (k === "ok") {
        if (this.mid === "youtube" && !Tube.native) { Apps.launch(); return true; } // no api key, or set to VacuumTube: opens VacuumTube; the app stays here
        go(this.mid === "np" ? new NowPlaying() : this.mid === "lv" ? new LivePage(Live.guide, Live.i) : sectionPage(this.mid));
        return true;
      }
      return false;
    }
    const row = this.rows[this.qr];
    if (k === "right") { if (this.qc === row.length - 1) this.setSec(0); else { this.qc++; this.paint(); } return true; }
    if (k === "left") { this.qc = Math.max(this.qc - 1, 0); this.paint(); return true; }
    if (k === "up" || k === "down") {
      this.qr = clamp(this.qr + (k === "up" ? -1 : 1), 0, this.rows.length - 1);
      this.qc = Math.min(this.qc, this.rows[this.qr].length - 1); this.paint(); return true;
    }
    if (k === "ok") { openItem(row[this.qc].item); return true; }
    return false;
  }
  player(evt) {
    if (evt === "track") applyBg(this);
  }
}

/* ============ pivot page: giant title, small caps sections, content below ============ */
const PIVOT_GAP = 44;  // must match .pivot-strip gap in styles.css
const TITLE_PAN = 150; // how far the giant title drifts per section (slower than the content = parallax)

class PivotPage extends Page {
  // sections: [{ name, load() -> items (or a promise of them), view(items, focus) -> List/Grid, open(item, index, items) }]
  // subtitle: a small caps line under the section labels (e.g. the artist's name under "music")
  constructor({ title, subtitle, sections, bg, heroName }) {
    super();
    Object.assign(this, { title, subtitle, sections, bgInfo: bg, heroName });
    this.pv = 0; this.focus = {}; this.lock = false; this.stripAnim = null;
    // focus starts on the section labels: ←/→ switch sections, ↓ or Enter goes into the content,
    // ↑ from the top of the content comes back up to the labels
    this.zone = "head";
  }
  get titleKey() { return lower(this.title); }
  titlePan() { return `${-this.pv * TITLE_PAN}px 0px`; }
  paintZone() {
    if (!this.root) return;
    this.root.classList.toggle("head", this.zone === "head");
    this.body.classList.toggle("dimfocus", this.zone === "head");
  }
  render() {
    if (this.stale && this.stale()) this.sections.forEach(s => { s.data = undefined; s.loading = null; }); // (recordings changed meanwhile)
    const root = el("div", "pivot-page" + (this.subtitle ? " has-sub" : ""));
    this.root = root;
    this.titleEl = el("div", "sec-title z", esc(lower(this.title)));
    this.titleEl.style.translate = `${-this.pv * TITLE_PAN}px 0`;
    // the label row is clipped at its left edge, so labels gliding out disappear instead of hanging at the screen edge
    this.stripClip = el("div", "pivot-clip zs");
    this.strip = el("div", "pivot-strip");
    this.stripClip.append(this.strip);
    this.body = el("div", "pivot-body");
    root.append(this.titleEl, this.stripClip);
    if (this.subtitle) root.append(el("div", "pv-sub zs", esc(this.subtitle)));
    root.append(this.body);
    this.renderStrip(this.order(this.pv), this.pv);
    this.body.append(this.makeList().el);
    this.paintZone();
    return root;
  }
  bg() { const b = this.list && this.list.bg && this.list.bg(); return b || this.bgInfo || super.bg(); }
  order(start) { return this.sections.map((_, i) => (start + i) % this.sections.length); }
  renderStrip(order, on) {
    this.strip.innerHTML = "";
    order.forEach(i => this.strip.append(el("div", "pv" + (i === on ? " on" : ""), esc(this.sections[i].name))));
  }
  makeList() {
    const s = this.sections[this.pv];
    if (s.data === undefined) {
      if (!s.loading) {
        s.loading = Promise.resolve().then(() => s.load())
          .then(d => { s.data = d || []; }, err => { s.data = null; s.error = err.message || String(err); });
      }
      const msg = Message("loading…"), pv = this.pv;
      this.list = msg;
      s.loading.then(() => {
        if (!this.el || this.pv !== pv || this.list !== msg) return;
        const L = this.makeList();
        msg.el.replaceWith(L.el);
        turnIn(visibleT(L.el), 1, { stagger: 30, dur: 480 });
      });
      return msg;
    }
    if (s.data === null) return (this.list = Message("couldn't load this — " + lower(s.error)));
    if (!s.data.length) return (this.list = Message(s.empty || "nothing here yet"));
    if (s.views) { // this section has the side menu: its layout, size and order are the viewer's choice
      const v = Views.get(s.views.key, s.views.kind);
      s.shown = Views.sorted(s.data, s.views, v);
      this.list = Views.make(s.views.kind, v, s.shown, this.focus[s.name] || 0);
      this.hookBg();
    } else {
      s.shown = s.data;
      this.list = s.view(s.data, this.focus[s.name] || 0);
    }
    return this.list;
  }

  // views with a backdrop (showcase, details, carousel): the background follows the picked title
  hookBg() {
    const L = this.list;
    if (L && L.bg) L.onFocus = () => {
      clearTimeout(this.bgT);
      this.bgT = setTimeout(() => { if (top() === this && this.list === L) applyBg(this); }, 220);
    };
    if (this.el && top() === this) applyBg(this);
  }
  // ----- the hidden view menu (see Views) -----
  openDrawer() {
    const s = this.sections[this.pv], K = VIEW_KINDS[s.views.kind], v = Views.get(s.views.key, s.views.kind);
    const groups = [["layout", "mode", K.layouts], ["size", "size", VIEW_SIZES]];
    if (s.views.sort) groups.push(["sort", "sort", K.sorts]);
    const d = el("div", "vdrawer");
    d.append(el("div", "vd-head sc", "view"));
    this.dOpts = [];
    for (const [label, key, opts] of groups) {
      d.append(el("div", "vd-lab sc", label));
      for (const [val, text] of opts) {
        const o = el("div", "vd-opt", esc(text));
        o.dataset.key = key; o.dataset.val = val;
        d.append(o); this.dOpts.push(o);
      }
    }
    this.drawer = d; this.root.append(d);
    this.df = Math.max(0, this.dOpts.findIndex(o => v[o.dataset.key] === o.dataset.val));
    this.paintDrawer();
    this.zone = "drawer";
    void d.offsetWidth; // start from off screen, then slide in (styles.css)
    this.root.classList.add("drawer");
  }
  closeDrawer() {
    const d = this.drawer;
    this.root.classList.remove("drawer");
    this.zone = "list"; this.drawer = null;
    setTimeout(() => d.remove(), 400);
  }
  paintDrawer() {
    const v = Views.get(this.sections[this.pv].views.key, this.sections[this.pv].views.kind);
    this.dOpts.forEach((o, i) => {
      o.classList.toggle("focus", i === this.df);
      o.classList.toggle("on", v[o.dataset.key] === o.dataset.val);
    });
  }
  pickView(o) {
    const s = this.sections[this.pv], v = Views.get(s.views.key, s.views.kind);
    if (v[o.dataset.key] === o.dataset.val) return;
    v[o.dataset.key] = o.dataset.val;
    Views.set(s.views.key, v);
    this.paintDrawer();
    // rebuild the covers in the new arrangement, staying on the same item
    const item = this.list.item;
    s.shown = Views.sorted(s.data, s.views, v);
    const L = Views.make(s.views.kind, v, s.shown, Math.max(0, s.shown.indexOf(item)));
    const old = this.list.el;
    old.replaceWith(L.el); this.list = L;
    this.hookBg();
    turnIn(visibleT(L.el), 1, { stagger: 22, dur: 420 });
  }
  drawerKey(k) {
    if (k === "up" || k === "down") { this.df = clamp(this.df + (k === "up" ? -1 : 1), 0, this.dOpts.length - 1); this.paintDrawer(); }
    else if (k === "ok") this.pickView(this.dOpts[this.df]);
    else if (k === "right" || k === "back") this.closeDrawer();
    return true;
  }
  async pivot(dir) {
    if (this.lock || this.sections.length < 2) return;
    this.lock = true;
    const n = this.sections.length, old = this.pv;
    this.focus[this.sections[old].name] = this.list.index;
    this.pv = (old + dir + n) % n;

    // 1. the section labels glide so the new one sits at the left
    if (this.stripAnim) { this.stripAnim.cancel(); this.stripAnim = null; }
    // Moving right, the outgoing label is drawn twice (it also reappears at the far end, since the
    // labels loop), so mark only the one copy that's sliding out as the current label.
    this.renderStrip(dir > 0 ? [old, ...this.order(this.pv)] : this.order(this.pv), -1);
    const newHead = this.strip.children[dir > 0 ? 1 : 0], oldHead = this.strip.children[dir > 0 ? 0 : 1];
    oldHead.classList.add("on");
    let from, to;
    if (dir > 0) { from = 0; to = -(this.strip.children[0].offsetWidth + PIVOT_GAP); }
    else { from = -(this.strip.children[0].offsetWidth + PIVOT_GAP); to = 0; }
    oldHead.classList.remove("on"); newHead.classList.add("on"); // offsetWidth above forced a style pass, so this animates
    const a = this.strip.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
      { duration: 650, easing: EASE, fill: "forwards" });
    this.stripAnim = a;
    const settle = () => {
      if (this.stripAnim !== a || !this.el) return;
      this.renderStrip(this.order(this.pv), this.pv); a.cancel(); this.stripAnim = null;
    };
    a.finished.then(settle).catch(() => {});
    setTimeout(settle, 700);

    // 2. the giant title drifts a little behind everything
    this.titleEl.style.translate = `${-this.pv * TITLE_PAN}px 0`;

    // 3. the old content slips away, the new content feathers in
    const oldList = this.list.el;
    oldList.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dir * 160}px)` }],
      { duration: 170, easing: EASE_IN, fill: "forwards" });
    setTimeout(() => oldList.remove(), 200);
    await wait(110);
    if (!this.el) return;
    const L = this.makeList();
    this.body.append(L.el);
    slideIn(visibleT(L.el), dir, { dist: 320, stagger: 34 });
    await wait(150);
    this.lock = false;
  }
  key(k) {
    if (this.zone === "drawer") return this.drawerKey(k);
    if (this.zone === "head") {
      if (k === "left" || k === "right") { this.pivot(k === "left" ? -1 : 1); return true; }
      if (k === "down" || k === "ok") { if (!this.list.message) { this.zone = "list"; this.paintZone(); } return true; }
      return k === "up";
    }
    if (k === "up" && this.list.atTop) { this.zone = "head"; this.paintZone(); return true; }
    if (k === "up") { this.list.move(-1); return true; }
    if (k === "down") { this.list.move(1); return true; }
    if (k === "left") { // at the left edge: the view menu where there is one, otherwise the previous section
      if (!this.list.moveX(-1)) { if (this.sections[this.pv].views && !this.list.message) this.openDrawer(); else this.pivot(-1); }
      return true;
    }
    if (k === "right") { if (!this.list.moveX(1)) this.pivot(1); return true; }
    if (k === "ok") {
      const s = this.sections[this.pv], it = this.list.item;
      if (!it || it.letter) return true;
      this.focus[s.name] = this.list.index;
      s.open(it, this.list.index, s.shown || s.data);
      return true;
    }
    return false;
  }
}

/* ============ a titled list that loads (genre albums, playlist songs, …) ============ */
class ListPage extends Page {
  // section: the giant title stays the section's ("music", "movies"); the list's own name sits under it in bold caps
  constructor({ title, sub, load, view, open, bg, section }) {
    super();
    Object.assign(this, { title, sub, load, view, open, bgInfo: bg, section });
    this.f = 0; this.data = undefined;
  }
  get titleKey() { return this.section || lower(this.title); }
  render() {
    const r = el("div", "sub-page");
    this.subEl = el("div", "sc", esc(this.subText()));
    const head = el("div", "alb-head zs", `<div class="an">${esc(this.title)}</div>`);
    head.append(this.subEl);
    r.append(el("div", "sec-title z", esc(this.titleKey)), head);
    this.body = el("div", "page-body"); r.append(this.body);
    this.fillBody();
    return r;
  }
  subText() { return typeof this.sub === "function" ? (this.data ? this.sub(this.data) : "") : this.sub || ""; }
  fillBody() {
    this.body.innerHTML = "";
    if (this.data === undefined) this.list = Message("loading…");
    else if (this.data === null) this.list = Message("couldn't load this — " + lower(this.error));
    else if (!this.data.length) this.list = Message("nothing here yet");
    else this.list = this.view(this.data, this.f);
    this.body.append(this.list.el);
  }
  mounted() {
    if (this.data !== undefined) return;
    Promise.resolve().then(() => this.load()).then(d => { this.data = d || []; }, err => { this.data = null; this.error = err.message; })
      .then(() => {
        if (!this.el) return;
        this.fillBody(); this.subEl.textContent = this.subText();
        turnIn(visibleT(this.body), 1, { stagger: 30, dur: 480 });
      });
  }
  bg() { return this.bgInfo || super.bg(); }
  key(k) {
    if (k === "up" || k === "down") { this.list.move(k === "up" ? -1 : 1); return true; }
    if (k === "left" || k === "right") { this.list.moveX(k === "left" ? -1 : 1); return true; }
    if (k === "ok") {
      const it = this.list.item;
      if (!it || it.letter) return true;
      this.f = this.list.index; this.open(it, this.f, this.data);
      return true;
    }
    return false;
  }
}

/* ============ music ============ */
const artistPhoto = a => (a && a.photo) || (a && a.emby && Emby.artistBackdrop(a)) || Art.photo(a.name, a.hue); // radio: the song's cover
const songsOf = n => `${n} song${n === 1 ? "" : "s"}`;

function musicPage() {
  const live = Emby.connected;
  return new PivotPage({
    title: "music", heroName: "music",
    sections: [
      { name: "albums", load: () => live ? Emby.albums() : LIB.albums, view: albumGrid, views: { key: "albums", kind: "album", sort: true }, open: al => go(new AlbumPage(al)) },
      { name: "artists", load: () => live ? Emby.artists() : LIB.artists, view: artistGrid, views: { key: "artists", kind: "artist", sort: true }, open: ar => go(artistPage(ar)) },
      {
        name: "playlists", load: () => live ? Emby.playlists() : LIB.playlists, view: listView(116, ROW.playlist),
        open: p => go(new ListPage({ section: "music", title: p.name, sub: d => songsOf(d.length), load: () => p.tracks || Emby.playlistTracks(p.id), view: listView(116, ROW.song), open: (s, i, d) => playAndShow(d, i) })),
      },
      { name: "songs", load: () => live ? Emby.songs() : LIB.songs, view: listView(116, ROW.song), open: (s, i, d) => playAndShow(d, i) },
      {
        name: "genres", load: () => live ? Emby.musicGenres() : LIB.genres, view: listView(96, ROW.genre),
        open: g => go(new ListPage({ section: "music", title: g.name, sub: d => `${d.length} album${d.length === 1 ? "" : "s"}`, load: () => g.albums || Emby.genreAlbums(g.id), view: listView(140, ROW.album), open: al => go(new AlbumPage(al)) })),
      },
    ],
  });
}

function artistPage(ar) {
  const live = ar.emby;
  let songs = null;
  return new PivotPage({
    title: "music", subtitle: ar.name,
    bg: { src: artistPhoto(ar), fallback: Art.photo(ar.name, ar.hue), opacity: 0.6, drift: true },
    sections: [
      { name: "albums", load: () => live ? Emby.artistAlbums(ar.id) : ar.albums, view: listView(140, ROW.albumYear), open: al => go(new AlbumPage(al)) },
      { name: "songs", load: () => live ? Emby.artistSongs(ar.id) : ar.albums.flatMap(a => a.tracks), view: listView(116, ROW.song), open: (s, i, d) => playAndShow(d, i) },
      {
        name: "bio", load: async () => { const i = live ? await Emby.artistInfo(ar) : null; return i && i.bio ? [i] : []; },
        view: items => BioView(items[0]), open: () => {}, empty: "emby has no biography for this artist yet",
      },
    ],
  });
}

// The artist's biography, big and readable; ↑ ↓ scroll it. While it's showing, the backdrop behind
// changes between the artist's photos (when Emby has more than one), each one drifting slowly.
function BioView(info) {
  const view = el("div", "list bio"); view.style.height = "740px";
  const inner = el("div", "bio-in t"); view.append(inner);
  inner.innerHTML = info.bio.split(/\n\s*\n|\n/).filter(p => p.trim()).map(p => `<p>${esc(p.trim())}</p>`).join("");
  let y = 0, n = 0;
  const shots = info.backdrops.length ? info.backdrops : [];
  const cycle = setInterval(() => {
    if (!view.isConnected) return clearInterval(cycle);
    if (shots.length < 2) return;
    n = (n + 1) % shots.length;
    $bgImg.style.opacity = 0;
    setTimeout(() => { if (view.isConnected) { $bgImg.src = shots[n]; $bgImg.style.opacity = 0.6; } }, 700);
  }, 14000);
  return {
    el: view, index: 0, item: null,
    get atTop() { return y === 0; },
    move(d) {
      const max = Math.max(0, inner.scrollHeight - 700);
      const ny = clamp(y + d * 220, 0, max);
      if (ny === y) return bounce(inner, -y, d);
      y = ny;
      inner.style.transition = `transform 420ms ${EASE}`;
      inner.style.transform = `translateY(${-y}px)`;
    },
    moveX() { return false; },
  };
}

class AlbumPage extends Page {
  constructor(al) { super(); this.al = al; this.f = 0; this.tracks = al.tracks; }
  get titleKey() { return "music"; }
  render() {
    const al = this.al, r = el("div", "album-page");
    // like the Zune HD: "music" stays the giant title; the album name sits under it in bold caps
    r.append(el("div", "sec-title z", "music"),
      el("div", "alb-head zs", `<div class="an">${esc(al.title)}</div><div class="sc">${[esc(al.artist.name), al.year].filter(Boolean).join(" · ")}</div>`));
    const art = el("img", "album-art flip"); setCover(art, al); art.alt = "";
    r.append(art);
    const col = el("div", "album-tracks"); r.append(col);
    // round action buttons above the songs, like the Zune HD (up from the first song reaches them)
    const btns = el("div", "alb-btns");
    this.btnEls = [["play", ICON.play, "play all"], ["shuffle", ICON.shuffle, "shuffle"]].map(([id, icon, label]) => {
      const b = el("div", "rb t", `<span class="ring">${icon}</span><span class="lbl">${label}</span>`);
      b.dataset.id = id; btns.append(b); return b;
    });
    this.zone = this.zone || "list"; this.bi = this.bi || 0;
    this.body = el("div", "alb-list");
    col.append(btns, this.body);
    this.fillBody();
    return r;
  }
  fillBody() {
    this.body.innerHTML = "";
    this.list = this.tracks === undefined ? Message("loading…", 640) : this.tracks === null ? Message("couldn't load the songs", 640)
      : List({ items: this.tracks, itemH: 84, row: ROW.track, focus: this.f, height: 640 });
    this.body.append(this.list.el);
    this.paint();
  }
  paint() {
    this.btnEls.forEach((b, i) => b.classList.toggle("focus", this.zone === "btns" && i === this.bi));
    this.body.classList.toggle("dimfocus", this.zone === "btns");
  }
  mounted() {
    if (this.tracks !== undefined) return;
    Emby.albumTracks(this.al).then(t => { this.tracks = t; }, () => { this.tracks = null; }).then(() => {
      if (!this.el) return;
      this.fillBody(); turnIn(visibleT(this.body), 1, { stagger: 30, dur: 480 });
    });
  }
  bg() { const a = this.al.artist; return { src: artistPhoto(a), fallback: Art.photo(a.name, a.hue), opacity: 0.4 }; }
  key(k) {
    if (this.zone === "btns") {
      if (k === "left" || k === "right") { this.bi = clamp(this.bi + (k === "left" ? -1 : 1), 0, this.btnEls.length - 1); this.paint(); return true; }
      if (k === "down") { this.zone = "list"; this.paint(); return true; }
      if (k === "ok" && this.tracks && this.tracks.length) {
        const list = this.btnEls[this.bi].dataset.id === "shuffle" ? [...this.tracks].sort(() => Math.random() - 0.5) : this.tracks;
        playAndShow(list, 0);
      }
      return k !== "back";
    }
    if (k === "up" && this.list.index === 0) { this.zone = "btns"; this.paint(); return true; }
    if (k === "up" || k === "down") { this.list.move(k === "up" ? -1 : 1); return true; }
    if (k === "ok" && this.tracks) { this.f = this.list.index; playAndShow(this.tracks, this.f); return true; }
    return false;
  }
}

/* ============ radio (AudioAddict networks, like the old hub) ============
   Needs a premium listen key (settings → radio). Station lists and "now playing" come from the
   AudioAddict API; the music itself streams straight from the network. */
const RADIO_NETWORKS = [
  { id: "di", name: "di.fm", domain: "di.fm" },
  { id: "radiotunes", name: "radiotunes", domain: "radiotunes.com" },
  { id: "jazzradio", name: "jazzradio", domain: "jazzradio.com" },
  { id: "rockradio", name: "rockradio", domain: "rockradio.com" },
  { id: "classicalradio", name: "classical radio", domain: "classicalradio.com" },
  { id: "zenradio", name: "zenradio", domain: "zenradio.com" },
];
const Radio = {
  cache: {},
  get key() { return String(Prefs.get("radioKey") || "").trim(); },
  // AudioAddict image addresses look like "//cdn…/abc.png{?size,height,width}". The size has to be
  // written "400x400": a plain "400" is ignored and the full ~2 MB original comes down instead.
  // (The pictures are kept by the browser for good once loaded, so later visits are instant.)
  img(u, size) {
    if (!u) return null;
    u = String(u).trim().replace(/\{\?[^}]+\}/g, "");
    if (u.startsWith("//")) u = "https:" + u;
    return u + (u.includes("?") ? "&" : "?") + `size=${size}x${size}`;
  },
  // station lists: kept for a day (so the grid appears at once), then refreshed
  async channels(net) {
    if (this.cache[net.id]) return this.cache[net.id];
    const saveKey = "mc.radio." + net.id, now = Date.now();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(saveKey) || "null"); } catch {}
    let raw = saved && now - saved.at < 24 * HOUR ? saved.list : null;
    if (!raw) {
      try {
        const r = await fetch(`https://api.audioaddict.com/v1/${net.id}/channels`);
        if (!r.ok) throw new Error(`the ${net.name} station list didn't load (${r.status})`);
        raw = (await r.json()).map(c => {
          const im = c.images || {};
          return { id: c.id, key: c.key, name: c.name || c.key, desc: c.description_short || "", art: im.square || im.default || c.asset_url || "" };
        });
        try { localStorage.setItem(saveKey, JSON.stringify({ at: now, list: raw })); } catch {}
      } catch (e) {
        if (!saved) throw e;
        raw = saved.list; // offline: an older list is better than none
      }
    }
    const list = raw.map(c => ({
      id: c.id, key: c.key, title: c.name, desc: c.desc, net,
      img: this.img(c.art, 400), hue: Emby.hashHue(c.name), radio: true,
    })).sort((a, b) => a.title.localeCompare(b.title));
    return (this.cache[net.id] = list);
  },
  // the "track" the player plays for a station; song details are filled in by watch().
  // Through the helper, the station is passed along by it so the song name arrives the moment a
  // song changes (opened without the helper, it plays directly and falls back to slower checks).
  track(st) {
    const k = encodeURIComponent(this.key), host = `prem1.${st.net.domain}`, key = encodeURIComponent(st.key);
    const via = location.protocol.startsWith("http") ? u => HELPER + "/radio/stream?url=" + encodeURIComponent(u) : u => u;
    return {
      id: `radio:${st.net.id}:${st.id}`, title: st.title, live: true, station: st, dur: 0,
      artist: { name: st.net.name, hue: st.hue, photo: st.img },
      album: { id: `radio:${st.id}`, title: st.title, hue: st.hue, img: st.img, imgs: [st.img] },
      stream: via(`http://${host}/${key}?${k}`),
      alt: [via(`http://${host}/${key}?listen_key=${k}`), via(`http://prem2.${st.net.domain}/${key}?${k}`)],
    };
  },
  history(t) { // the station's most recent songs, newest first (with artwork)
    return fetch(`https://api.audioaddict.com/v1/${t.station.net.id}/track_history/channel/${t.station.id}?_=${Date.now()}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : []).catch(() => []);
  },
  show(t, title, artist, art) {
    if (title === t.title && artist === t.artist.name && (!art || (t.album.imgs || [])[0] === art)) return;
    t.title = title || t.station.title;
    const who = artist || t.station.net.name;
    // the same artist again (or the cover arriving late): their photos stay up, still sliding
    if (!(t.artist.pics && t.artist.name === who)) {
      const pics = ArtistArt.known(artist); // found earlier (and loaded): they come in with the song
      t.artist = pics ? { name: who, hue: Emby.hashHue(who), pics, pick: 0, photo: pics[0] }
        : { name: who, hue: Emby.hashHue(who), photo: art || t.station.img };
    }
    t.album = { ...t.album, imgs: [art, t.station.img].filter(Boolean) };
    emit("track", 1);
    ArtistArt.attach(t);
  },
  // what AudioAddict says is on a station right now: { id, title, artist, ends } (ends: when the song
  // finishes, in ms). The network-wide "currently playing" list changes the moment a song starts —
  // much sooner than the station's song list, which can lag half a minute.
  async current(t) {
    const net = t.station.net.id;
    const list = await fetch(`https://api.audioaddict.com/v1/${net}/currently_playing?_=${Date.now()}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const hit = Array.isArray(list) && list.find(x => x && Number(x.channel_id) === Number(t.station.id));
    const tr = hit && hit.track;
    if (tr && (tr.display_title || tr.title)) {
      const start = Date.parse(tr.start_time || "") || 0, dur = Number(tr.duration || tr.length) || 0;
      return { id: tr.id, title: tr.display_title || tr.title, artist: tr.display_artist || tr.artist || "", ends: start && dur ? start + dur * 1000 : 0 };
    }
    const h = (await this.history(t)).find(x => x && !x.ad && x.type !== "advertisement"); // (not in the list: the song list instead)
    if (!h) return null;
    const start = (Number(h.started) || 0) * 1000, dur = Number(h.duration || h.length) || 0;
    return { id: h.track_id || h.id, title: h.title || h.display_title, artist: h.artist || h.display_artist || "", ends: start && dur ? start + dur * 1000 : 0, art: this.img(h.art_url, 800) };
  },
  // a song's cover, from its details (kept, so a song is only looked up once)
  arts: new Map(),
  async art(net, id) {
    if (!id) return null;
    if (this.arts.has(id)) return this.arts.get(id);
    const d = await fetch(`https://api.audioaddict.com/v1/${net}/tracks/${id}`).then(r => r.ok ? r.json() : null).catch(() => null);
    const url = this.img(d && d.images && d.images.default, 800);
    if (url) this.arts.set(id, url);
    return url;
  },
  // load a picture before showing it, so the new song and its cover arrive together (gives up after a while)
  preload(url, ms = 1500) {
    return !url ? Promise.resolve() : Promise.race([
      new Promise(res => { const im = new Image(); im.onload = im.onerror = res; im.src = url; }),
      wait(ms),
    ]);
  },
  // Keeps the song name and cover current, the way the old Zune hub and the Kodi add-on do it:
  // - AudioAddict's "currently playing" list says which song is on, with its id and when it ends; the
  //   cover comes from that song's details and is loaded ahead. It's checked every 2 s near the end of
  //   a song and less often in between.
  // - With the helper, the stream itself announces each song the moment you hear it. That decides
  //   WHEN to switch: the new name and its (already loaded) cover then come in together, once.
  //   If AudioAddict hasn't caught up yet, it's asked again every second for a few seconds; after
  //   that the name shows with the station's picture and the cover follows when it turns up.
  // - Without the helper, the switch follows the "currently playing" list alone.
  watch(t) {
    clearTimeout(this.timer); clearInterval(this.fast); clearTimeout(this.burst);
    if (!t || !t.live) return;
    const mine = () => Player.track === t;
    const norm = x => String(x || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
    const match = (a, b) => !!(a && b) && norm(a.title) === norm(b.title) && (!norm(a.artist) || !norm(b.artist) || norm(a.artist) === norm(b.artist));
    const net = t.station.net.id;
    const direct = new URL(t.stream, location.href).searchParams.get("url");
    let api = null, heard = null, waiting = 0;
    const put = x => this.show(t, x.title, x.artist, x.art || null);
    const settle = () => {
      if (!mine()) return;
      if (direct && heard) {
        if (match(api, heard)) { waiting = 0; return put(api); } // the name and its cover, together
        if (match(heard, { title: t.title, artist: t.artist.name })) return; // already showing what you hear
        if (waiting > 0) return;                                  // still giving AudioAddict a moment
        return put({ title: heard.title, artist: heard.artist });  // it never caught up: the name alone
      }
      if (api) put(api);
    };
    const check = async () => {
      clearTimeout(this.timer);
      if (!mine()) return;
      if (Player.playing) {
        const cur = await this.current(t);
        if (!mine()) return;
        if (cur && (!api || cur.id !== api.id || !api.art)) {
          cur.art = cur.art || await this.art(net, cur.id);
          ArtistArt.warm(cur.artist); // (the artist's photos get a head start, while the cover loads)
          await this.preload(cur.art);
          if (!mine()) return;
          api = cur;
        }
        settle();
      }
      // when to look again: every 2 s in a song's last 45 s (and while waiting on a change), else later
      const left = api && api.ends ? api.ends - Date.now() : 0;
      const next = waiting > 0 ? 1000 : !Player.playing ? 5000 : !left ? 5000 : left <= 45000 ? 2000 : Math.min(15000, left - 45000);
      if (waiting > 0) waiting--;
      this.timer = setTimeout(check, next);
    };
    if (direct) {
      this.fast = setInterval(async () => {
        if (!mine()) return clearInterval(this.fast);
        if (!Player.playing) return;
        const url = new URL(t.stream, location.href).searchParams.get("url") || direct; // (a backup address may be in use)
        const m = await fetch(HELPER + "/radio/now?url=" + encodeURIComponent(url), { headers: { "X-Media-Center": "1" }, cache: "no-store" })
          .then(r => r.ok ? r.json() : null).catch(() => null);
        if (!m || !m.raw || !mine() || (heard && heard.raw === m.raw)) return;
        heard = { raw: m.raw, title: m.title, artist: m.artist };
        if (match(api, heard)) return settle();   // AudioAddict already had it (and its cover is loaded)
        waiting = 4;                              // ask AudioAddict now, then every second for ~4 s
        check();
        clearTimeout(this.burst);
        this.burst = setTimeout(() => { waiting = 0; settle(); }, 4200);
      }, 1000);
    }
    check();
  },
};

/* Radio artist slideshow, like Kodi's Artist Slideshow: big photos of the artist on now, sliding
   behind the song on the home screen, now playing and the screensaver. Your Emby pictures come
   first (when the artist is in your library); otherwise the helper looks the artist up on fanart.tv
   (with your key, settings → radio) and Deezer. Each artist is looked up once. With nothing found,
   the song's cover stays, blurred and darkened (the "soft" look), so its low resolution doesn't show. */
const ArtistArt = {
  seen: new Map(),
  get(name) {
    const k = String(name || "").trim().toLowerCase();
    if (!k || NATIVE) return Promise.resolve([]);
    if (!this.seen.has(k)) {
      const p = (async () => {
        const e = Emby.connected ? await Emby.artistInfo({ name }).catch(() => null) : null;
        if (e && e.backdrops.length) return e.backdrops;
        const r = await fetch(HELPER + "/art/artist?name=" + encodeURIComponent(name), { headers: { "X-Media-Center": "1" }, cache: "no-store" })
          .then(r => r.ok ? r.json() : null).catch(() => null);
        if (!r || r.error) this.seen.delete(k); // the helper or a service didn't answer: ask again next time
        return r ? ((r.wide && r.wide.length ? r.wide : r.photos) || []) : [];
      })();
      this.seen.set(k, p);
    }
    return this.seen.get(k);
  },
  forget() { this.seen.clear(); this.ready.clear(); }, // after the fanart.tv key changes
  // artists whose photos are found and the first one loaded: they arrive together with the song
  ready: new Map(),
  // start looking as soon as the next song is known (often before you hear it), so its photos are ready
  async warm(name) {
    const k = String(name || "").trim().toLowerCase();
    if (!k || this.ready.has(k)) return this.ready.get(k);
    const pics = (await this.get(name)).filter(Boolean);
    if (!pics.length) return null;
    await Radio.preload(pics[0], 6000);
    this.ready.set(k, pics);
    return pics;
  },
  known(name) { return this.ready.get(String(name || "").trim().toLowerCase()) || null; },
  // a first-time artist: their photos blend in once found (and loaded), while that song is still on.
  // Only the background changes: no new-song animation, and hidden song info stays hidden.
  async attach(t) {
    const a = t.artist;
    if (!t.live || !a || a.pics || !a.name || a.name === t.station.net.name) return;
    const pics = await this.warm(a.name);
    if (!pics || Player.track !== t || t.artist !== a) return;
    t.artist = { ...a, pics, pick: 0, photo: pics[0] };
    this.repaint(t);
    if (Saver.on && Saver.shown === t) Saver.setPics(pics);
  },
  repaint(t) {
    const p = top(); if (!p || !p.el) return;
    if (p instanceof NowPlaying) p.setBg(t);
    else if (p instanceof Home) blendBg(p);
  },
  // every 20 s the next photo, loaded first so it fades in whole
  tick() {
    const t = Player.track, a = t && t.artist;
    if (!t || !t.live || !a || !a.pics || a.pics.length < 2 || Live.active) return;
    const n = (a.pick + 1) % a.pics.length;
    Radio.preload(a.pics[n], 8000).then(() => {
      if (Player.track !== t || t.artist !== a) return;
      a.pick = n; a.photo = a.pics[n];
      this.repaint(t);
    });
  },
};
setInterval(() => ArtistArt.tick(), 20000);
// a radio artist with nothing better than the song's small cover (or the station's picture)
const softArtist = t => !!(t && t.live && !(t.artist && t.artist.pics));
const stationGrid =(items, focus) => Grid({ items, cols: 7, w: 220, h: 220, cell: CELL.station, focus });
function radioPage() {
  return new PivotPage({
    title: "radio", heroName: "radio",
    sections: RADIO_NETWORKS.map(net => ({
      name: net.name, load: () => Radio.channels(net), view: stationGrid, views: { key: "radio", kind: "station", sort: true },
      open: (st, i, list) => {
        if (!Radio.key) return toast("add your radio listen key in settings → radio");
        Player.play(list.map(s => Radio.track(s)), i);
        go(new NowPlaying());
      },
    })),
  });
}

/* ============ youtube, native (your api key + YouTube's own embedded player) ============
   Lists come from the official YouTube Data API with your key (settings → youtube). Videos play in
   YouTube's embedded player, full screen, under the app's own Zune-style controls. Signed in to
   youtube.com in the app's browser (settings → youtube → sign in), YouTube Premium applies, so no ads.
   (Named Tube, not YT: YouTube's player script claims the name YT for itself.) */
const Tube = {
  get key() { return String(Prefs.get("ytKey") || "").trim(); },
  get native() { return !!this.key && Prefs.get("ytOpen") !== "vacuumtube"; }, // else the menu opens VacuumTube
  region() { const m = String(navigator.language || "").match(/-([A-Za-z]{2})$/); return (m ? m[1] : "US").toUpperCase(); },
  async api(path, params) {
    if (!this.key) throw new Error("add your youtube api key in settings → youtube");
    const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?` + new URLSearchParams({ ...params, key: this.key }));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = (d.error && d.error.errors && d.error.errors[0] && d.error.errors[0].reason) || (d.error && d.error.status) || r.status;
      throw new Error({
        keyInvalid: "the youtube api key isn't valid — check it in settings → youtube",
        quotaExceeded: "today's youtube allowance is used up — it resets at midnight pacific time",
        dailyLimitExceeded: "today's youtube allowance is used up — it resets at midnight pacific time",
        accessNotConfigured: "the youtube data api isn't turned on for this key in google's console",
        forbidden: "this api key doesn't allow use from this pc (check its restrictions in google's console)",
      }[why] || `youtube said ${String(why).toLowerCase()}`);
    }
    return d;
  },
  map(v) {
    const sn = v.snippet || {}, th = sn.thumbnails || {}, cd = v.contentDetails || {}, st = v.statistics || {};
    const m = String(cd.duration || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
    const secs = (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
    const when = Date.parse(sn.publishedAt || "") || 0;
    const pic = (th.maxres || th.standard || th.high || th.medium || th.default || {}).url || "";
    return {
      id: v.id, yt: true, kind: "video", title: sn.title || "", channel: sn.channelTitle || "", channelId: sn.channelId,
      overview: sn.description || "", when, added: sn.publishedAt || "", runtime: secs, live: sn.liveBroadcastContent === "live",
      views: +st.viewCount || 0, img: pic, thumb: (th.medium || th.high || {}).url || pic, hue: Emby.hashHue(v.id),
    };
  },
  async trending() {
    const d = await this.api("videos", { part: "snippet,contentDetails,statistics", chart: "mostPopular", regionCode: this.region(), maxResults: 50 });
    return (d.items || []).map(v => this.map(v));
  },
  async search(q) { // (a search costs 100 of the 10,000 daily units; the details call after it, 1)
    const s = await this.api("search", { part: "snippet", type: "video", q, maxResults: 50, regionCode: this.region() });
    const ids = (s.items || []).map(i => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) return [];
    const d = await this.api("videos", { part: "snippet,contentDetails,statistics", id: ids.join(",") });
    const by = new Map((d.items || []).map(v => [v.id, v]));
    return ids.map(id => by.get(id)).filter(Boolean).map(v => this.map(v));
  },
  // where you stopped each video (YouTube doesn't share watch history with apps, so the app keeps its own)
  positions() { try { return JSON.parse(localStorage.getItem("mc.ytpos") || "{}"); } catch { return {}; } },
  posOf(id) { return this.positions()[id] || 0; },
  setPos(id, secs) {
    const all = this.positions();
    if (secs > 0) all[id] = Math.floor(secs); else delete all[id];
    const ids = Object.keys(all); if (ids.length > 300) ids.slice(0, ids.length - 300).forEach(k => delete all[k]);
    try { localStorage.setItem("mc.ytpos", JSON.stringify(all)); } catch {}
  },
  // ----- your account ("enter this code" sign-in; the helper keeps the pass and hands out short-lived access) -----
  signedIn: false, access: null, accessUntil: 0, feedCache: null,
  async account() { const st = await Apps.call("/apps/youtube/account"); this.signedIn = !!(st && st.signed_in); return st; },
  async token(force) {
    if (!force && this.access && Date.now() / 1000 < this.accessUntil) return this.access;
    const r = await Apps.call("/apps/youtube/token");
    if (!r || !r.ok) { this.access = null; if (r && /not signed in|invalid/i.test(r.error || "")) this.signedIn = false; throw new Error("sign in to youtube with a code in settings → youtube"); }
    this.access = r.token; this.accessUntil = r.until;
    return r.token;
  },
  async mine(path, params, retry = true) {
    const t = await this.token();
    const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?` + new URLSearchParams(params), { headers: { Authorization: "Bearer " + t } });
    if (r.status === 401 && retry) { await this.token(true); return this.mine(path, params, false); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("youtube said " + String((d.error && (d.error.errors?.[0]?.reason || d.error.status)) || r.status).toLowerCase());
    return d;
  },
  async details(ids) { // full details (length, views…) for a list of video ids, in their order
    const out = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const d = await this.api("videos", { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(",") });
      (d.items || []).forEach(v => out.set(v.id, this.map(v)));
    }
    return ids.map(id => out.get(id)).filter(Boolean);
  },
  async channels() { // the channels you subscribe to (up to 250)
    const out = []; let page = "";
    for (let n = 0; n < 5; n++) {
      const d = await this.mine("subscriptions", { part: "snippet", mine: "true", maxResults: 50, order: "alphabetical", ...(page ? { pageToken: page } : {}) });
      (d.items || []).forEach(s => {
        const sn = s.snippet || {}, th = sn.thumbnails || {};
        out.push({ id: sn.resourceId && sn.resourceId.channelId, name: sn.title || "", img: (th.high || th.medium || th.default || {}).url || "", hue: Emby.hashHue(sn.title || ""), ytChannel: true });
      });
      page = d.nextPageToken; if (!page) break;
    }
    return out.filter(c => c.id);
  },
  uploadsOf(channelId) { return "UU" + String(channelId).slice(2); }, // every channel's "uploads" playlist
  async playlistIds(playlistId, max = 50, mine = false) {
    const ids = []; let page = "";
    while (ids.length < max) {
      const params = { part: "contentDetails", playlistId, maxResults: Math.min(50, max - ids.length), ...(page ? { pageToken: page } : {}) };
      const d = mine ? await this.mine("playlistItems", params) : await this.api("playlistItems", params);
      (d.items || []).forEach(i => i.contentDetails && i.contentDetails.videoId && ids.push(i.contentDetails.videoId));
      page = d.nextPageToken; if (!page) break;
    }
    return ids;
  },
  // latest uploads from everyone you subscribe to, newest first (kept for 10 minutes)
  async feed() {
    if (this.feedCache && Date.now() - this.feedCache.at < 10 * 60e3) return this.feedCache.list;
    const chans = await this.channels(), recent = [];
    let i = 0;
    const worker = async () => {
      while (i < chans.length) {
        const c = chans[i++];
        try {
          const d = await this.api("playlistItems", { part: "contentDetails", playlistId: this.uploadsOf(c.id), maxResults: 4 });
          (d.items || []).forEach(x => x.contentDetails && recent.push({ id: x.contentDetails.videoId, at: Date.parse(x.contentDetails.videoPublishedAt || "") || 0 }));
        } catch { /* a channel without uploads */ }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    recent.sort((a, b) => b.at - a.at);
    const list = await this.details(recent.slice(0, 60).map(r => r.id));
    this.feedCache = { at: Date.now(), list };
    return list;
  },
  async playlists() {
    const d = await this.mine("playlists", { part: "snippet,contentDetails", mine: "true", maxResults: 50 });
    return (d.items || []).map(p => {
      const sn = p.snippet || {}, th = sn.thumbnails || {};
      return { id: p.id, playlist: true, kind: "video", title: sn.title || "", channel: sn.channelTitle || "", count: (p.contentDetails && p.contentDetails.itemCount) || 0,
        thumb: (th.medium || th.high || th.default || {}).url || "", img: (th.high || th.medium || {}).url || "", when: Date.parse(sn.publishedAt || "") || 0, hue: Emby.hashHue(p.id) };
    });
  },
  async playlistVideos(id) { return this.details(await this.playlistIds(id, 200, true)); },
  async channelVideos(channelId) { return this.details(await this.playlistIds(this.uploadsOf(channelId), 50)); },
  async liked() {
    const d = await this.mine("videos", { part: "snippet,contentDetails,statistics", myRating: "like", maxResults: 50 });
    return (d.items || []).map(v => this.map(v));
  },
  recent() { try { return JSON.parse(localStorage.getItem("mc.ytsearch") || "[]"); } catch { return []; } },
  remember(q) { const l = [q, ...this.recent().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8); try { localStorage.setItem("mc.ytsearch", JSON.stringify(l)); } catch {} },
};
const ago = t => {
  const s = (Date.now() - t) / 1000;
  for (const [n, w] of [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]]) {
    if (s >= n) { const k = Math.floor(s / n); return `${k} ${w}${k === 1 ? "" : "s"} ago`; }
  }
  return "just now";
};
const viewCount = n => n >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, "") + "b views" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m views" : n >= 1e3 ? Math.round(n / 1e3) + "k views" : n ? n + " views" : "";

// a video tile: 16:9 thumbnail with its length (or LIVE), the title, then channel · views · age
CELL.yt = v => el("div", "media video yt", `<div class="pic">${v.thumb ? imgTag(v.thumb) : `<span class="noimg"></span>`}${
  v.playlist ? `<span class="len">${v.count} video${v.count === 1 ? "" : "s"}</span>` : v.live ? `<span class="len live">live</span>` : v.runtime ? `<span class="len">${fmtT(v.runtime)}</span>` : ""}${
  Tube.posOf(v.id) && v.runtime ? `<span class="seen"><i style="width:${Math.min(100, Tube.posOf(v.id) / v.runtime * 100)}%"></i></span>` : ""}</div><div class="mcap"><b>${esc(v.title)}</b><span>${esc([v.channel, viewCount(v.views), v.when ? ago(v.when) : ""].filter(Boolean).join(" · "))}</span></div>`);
ROW.yt = v => el("div", "r-media video", `<div class="pic">${v.thumb ? imgTag(v.thumb) : ""}</div><div class="tx"><div class="t1">${esc(v.title)}</div><div class="t2 sc">${
  esc((v.playlist ? [`${v.count} videos`, v.channel] : [v.channel, v.live ? "live" : v.runtime ? fmtT(v.runtime) : "", viewCount(v.views), v.when ? ago(v.when) : ""]).filter(Boolean).join(" · "))}</div></div>`);
VIEW_KINDS.yt = {
  layouts: [["posters", "thumbnails"], ["list", "list"]],
  sorts: [["date:desc", "newest first"], ["title:asc", "title a–z"]],
  grid: { s: { cols: 6, w: 262, h: 214, gap: 22 }, m: { cols: 5, w: 318, h: 248, gap: 24 }, l: { cols: 3, w: 540, h: 372, gap: 30 } },
  cell: CELL.yt, row: ROW.yt, rowH: { s: 96, m: 130, l: 180 },
};

// The YouTube section. Signed in (settings → youtube → sign in with a code): SUBSCRIPTIONS (newest
// uploads from your channels), CHANNELS, PLAYLISTS and LIKED, then TRENDING and SEARCH.
function youtubePage() {
  const open = v => playYouTube(v);
  const yours = Tube.signedIn ? [
    { name: "subscriptions", load: () => Tube.feed(), views: { key: "youtube", kind: "yt" }, open, empty: "no new videos from your channels" },
    { name: "channels", load: () => Tube.channels(), views: { key: "ytchannels", kind: "artist", sort: true }, open: c => go(ytChannelPage(c)), empty: "you don't subscribe to any channels yet" },
    { name: "playlists", load: () => Tube.playlists(), views: { key: "youtube", kind: "yt" }, open: p => go(ytPlaylistPage(p)), empty: "you have no playlists" },
    { name: "liked", load: () => Tube.liked(), views: { key: "youtube", kind: "yt" }, open, empty: "no liked videos" },
  ] : [];
  return new PivotPage({
    title: "youtube", heroName: "youtube",
    sections: [
      ...yours,
      { name: "trending", load: () => Tube.trending(), views: { key: "youtube", kind: "yt" }, open },
      { name: "search", load: () => [{ search: true }, ...Tube.recent().map(q => ({ q }))], view: (items, f) => SearchView(items, f), open: x => x.search ? top().list.focusInput() : ytSearch(x.q) },
    ],
  });
}
const ytChannelPage = c => new PivotPage({
  title: "youtube", subtitle: c.name, bg: c.img ? { src: c.img, opacity: 0.35 } : undefined,
  sections: [{ name: "videos", load: () => Tube.channelVideos(c.id), views: { key: "youtube", kind: "yt" }, open: v => playYouTube(v), empty: "this channel has no videos" }],
});
const ytPlaylistPage = p => new PivotPage({
  title: "youtube", subtitle: p.title,
  sections: [{ name: "videos", load: () => Tube.playlistVideos(p.id), views: { key: "youtube", kind: "yt" }, open: v => playYouTube(v), empty: "this playlist is empty" }],
});

/* ---------- "enter this code": signing in to your YouTube account on the TV ----------
   Big and simple, like other TV apps: go to google.com/device on your phone, enter the code. The
   screen notices by itself when you're done. */
class YtCodePage extends Page {
  get titleKey() { return "youtube"; }
  render() {
    const r = el("div", "sub-page yt-code");
    r.innerHTML = `<div class="sec-title z">youtube</div>
      <div class="ytc-step zs sc">sign in to your youtube account</div>
      <div class="ytc-how first t">on your phone or computer, go to</div>
      <div class="ytc-url t"></div>
      <div class="ytc-how t">and enter this code</div>
      <div class="ytc-code t">· · · ·</div>
      <div class="ytc-state t sc">getting a code…</div>`;
    return r;
  }
  q(s) { return this.el.querySelector(s); }
  async mounted() { this.start(); }
  async start() {
    this.q(".ytc-state").textContent = "getting a code…";
    const r = await Apps.call("/apps/youtube/code", {});
    if (!this.el) return;
    if (r.server === false) { this.q(".ytc-state").textContent = "the helper isn't running — start the app with “Start Media Center”"; return; }
    if (!r.ok) { this.q(".ytc-state").textContent = lower(r.error || "google didn't give a code"); return; }
    this.q(".ytc-url").textContent = String(r.url || "google.com/device").replace(/^https?:\/\/(www\.)?/, "");
    const code = this.q(".ytc-code");
    code.textContent = r.code;
    code.animate([{ opacity: 0, transform: "scale(.9)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: EASE });
    this.q(".ytc-state").textContent = "waiting for you to sign in…";
    clearInterval(this.timer);
    this.timer = setInterval(() => this.check(), 3000);
  }
  async check() {
    const st = await Apps.call("/apps/youtube/account");
    if (!this.el) return;
    if (st.state === "signed_in") {
      clearInterval(this.timer);
      Tube.signedIn = true; Tube.feedCache = null;
      this.q(".ytc-state").textContent = "signed in";
      toast("signed in to youtube");
      setTimeout(() => { if (top() === this) back(); }, 900);
    } else if (st.state === "denied" || st.state === "expired" || st.state === "error") {
      clearInterval(this.timer);
      this.q(".ytc-state").textContent = (st.state === "denied" ? "sign-in was declined" : st.state === "expired" ? "that code ran out" : lower(st.error || "something went wrong")) + " — press enter for a new code";
      this.retry = true;
    }
  }
  unmount() { clearInterval(this.timer); super.unmount(); }
  key(k) {
    if (k === "ok" && this.retry) { this.retry = false; this.start(); return true; }
    return k !== "back";
  }
}
function ytSearch(q) {
  q = String(q || "").trim(); if (!q) return;
  Tube.remember(q);
  go(new PivotPage({
    title: "youtube", subtitle: `“${q}”`,
    sections: [{ name: "results", load: () => Tube.search(q), views: { key: "youtube", kind: "yt" }, open: v => playYouTube(v), empty: "nothing found" }],
  }));
}
// the search box (Enter on it to type, Enter again to search), with your recent searches under it
function SearchView(items, focus) {
  let input;
  const row = x => {
    if (!x.search) return el("div", "r-recent", `<span class="ic">↺</span><span class="t1">${esc(x.q)}</span>`);
    const r = el("div", "r-search", `<span class="ic">⌕</span>`);
    input = el("input", "yt-q"); Object.assign(input, { type: "text", placeholder: "search youtube", spellcheck: false, autocomplete: "off", tabIndex: -1 });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); const q = input.value; input.blur(); ytSearch(q); }
      else if (e.key === "Escape" || e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); input.blur(); }
    });
    r.append(input);
    return r;
  };
  const L = List({ items, itemH: 96, row, focus });
  L.focusInput = () => { input.focus(); input.select(); };
  return L;
}

/* ============ youtube (VacuumTube, started by the Media Center helper) ============ */
const Apps = {
  async call(path, body) {
    if (NATIVE) { // on the Shield, "youtube" hands over to the YouTube app (or SmartTube)
      if (path === "/apps/youtube/launch") return NATIVE.openYouTube() ? { ok: true } : { error: "no youtube app found on this device" };
      return { server: false };
    }
    try {
      const r = await fetch(path, {
        method: body ? "POST" : "GET",
        headers: { "X-Media-Center": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return r.ok ? await r.json() : { server: false };
    } catch { return { server: false }; }
  },
  status() { return this.call("/apps/youtube"); },
  setPath(path) { return this.call("/apps/youtube/path", { path }); },
  async launch() {
    const r = await this.call("/apps/youtube/launch", {});
    if (r.ok) { // like the old hub: whatever was playing stops when youtube opens
      Live.stop(); Player.stop();
      if (top() instanceof VodPage) back();
      return toast("opening youtube…");
    }
    if (r.server === false) return toast("youtube needs the app started with “Start Media Center”");
    toast(r.error || "youtube couldn't be opened");
  },
};

/* ============ what can I say? ============
   The voice assistant's own list of voice commands (what_can_i_say.json in its folder, read by the
   helper), one tab per group. It isn't part of the Media Center itself, so the commands stay as
   private as the assistant. Opened from settings → apps, or by saying "what can I say". */
const VOICE_ROW = v => el("div", "r-playlist", `<div class="tx"><div class="t1">“${esc(v.say)}”</div><div class="t2 sc">${esc(v.does)}</div></div>`);
async function voiceHelpPage() {
  const r = await Apps.call("/apps/assistant/commands");
  if (!r.ready) {
    const p = new Placeholder("what can i say", r.server === false ? "the helper isn't running — start the app with “Start Media Center”."
      : r.error || "the voice assistant's list of commands shows here once its folder is set in settings → apps.");
    p.heroName = null;
    return p;
  }
  return new PivotPage({
    title: "what can i say", subtitle: r.intro || "",
    sections: r.groups.map(g => ({ name: lower(g.name), load: () => g.items, view: listView(116, VOICE_ROW), open: () => {} })),
  });
}
/* ============ guide answers ============
   When the voice assistant finds several things for "is football on?" or "any christmas movies
   tonight?", it says the first one or two and puts the whole list here. Pick one to watch that
   channel. While you're watching tv it doesn't take over the screen: it only says them. */
function guideResultsPage(heading, items) {
  const progs = items.map(m => ({
    title: m.name || m.episodeTitle || "program", ep: m.episodeTitle && m.episodeTitle !== m.name ? m.episodeTitle : "",
    start: Number(m.startMs) || Date.parse(m.startDate), end: Number(m.endMs) || Date.parse(m.endDate),
    isMovie: !!m.isMovie, ch: { name: m.channelName || "", number: m.channelNumber || "" },
  }));
  return new PivotPage({
    title: "on the guide", subtitle: lower(heading || ""),
    sections: [{ name: "found", load: () => progs, view: listView(110, ROW.program),
      open: p => tuneChannel(p.ch.number || p.ch.name).catch(e => toast(lower(e.message))) }],
  });
}
async function showGuideResults(p) {
  const items = Array.isArray(p.items) ? p.items.slice(0, 40) : [];
  if (!items.length) return { shown: false };
  if (top() instanceof LivePage && !p.force) return { shown: false, watching: true };
  await settled();
  go(guideResultsPage(String(p.title || ""), items), { replace: !!(top() && top().titleKey === "on the guide") });
  return { shown: true };
}
async function showVoiceHelp() {
  await settled();
  if (top() && top().titleKey === "what can i say") return;
  go(await voiceHelpPage());
}

/* ============ movies & tv ============ */
function needEmby(name) {
  return new Placeholder(name, "sign in to your emby server in settings to see this.");
}
function moviesPage() {
  return new PivotPage({
    title: "movies", heroName: "movies",
    sections: [
      { name: "recent", load: () => Emby.newMovies(40), view: posterGrid, views: { key: "movies", kind: "video" }, open: m => go(new VideoPage(m)) },
      { name: "all", load: () => Emby.movies(), view: posterGrid, views: { key: "movies", kind: "video", sort: true }, open: m => go(new VideoPage(m)) },
      { name: "continue", load: () => Emby.resume().then(r => r.filter(x => x.type === "Movie")), view: posterGrid, views: { key: "movies", kind: "video" }, open: m => go(new VideoPage(m)), empty: "nothing in progress" },
      {
        name: "genres", load: () => Emby.movieGenres(), view: listView(96, ROW.genre),
        open: g => go(new ListPage({ section: "movies", title: g.name, sub: d => `${d.length} movie${d.length === 1 ? "" : "s"}`, load: () => Emby.genreMovies(g.id), view: posterGrid, open: m => go(new VideoPage(m)) })),
      },
    ],
  });
}
function tvPage() {
  return new PivotPage({
    title: "tv shows", heroName: "tv shows",
    sections: [
      { name: "shows", load: () => Emby.shows(), view: posterGrid, views: { key: "tv", kind: "video", sort: true }, open: s => openShow(s) },
      { name: "recent", load: () => Emby.newEpisodes(40), view: posterGrid, views: { key: "tv", kind: "video" }, open: x => x.type === "Series" ? openShow(x) : go(new VideoPage(x)) },
      { name: "continue", load: () => Emby.resume().then(r => r.filter(x => x.type === "Episode")), view: posterGrid, views: { key: "tv", kind: "video" }, open: x => go(new VideoPage(x)), empty: "nothing in progress" },
    ],
  });
}
/* ============ home videos & pictures ============
   Both come from Emby libraries ("home videos & photos" / "photos"). Sections: FOLDERS (your folders
   as Emby has them: Enter goes in, Back comes out), ALL (everything in one grid) and RECENT (newest
   additions). The hidden ← menu sets layout, size and order, remembered separately for each. */
function homeVideosPage() { return mediaSectionPage("home videos", "videos"); }
function picturesPage() { return mediaSectionPage("pictures", "photos"); }
function mediaSectionPage(title, kind) {
  const vk = kind === "photos" ? "photo" : "homevideo";
  let libs = null;
  const getLibs = async () => {
    if (!libs) libs = await Emby.mediaLibs(kind);
    if (!libs.length) throw new Error(`there's no ${kind === "photos" ? "photos" : "home videos"} library on your emby server`);
    return libs;
  };
  const opener = mediaOpener(title, kind, vk);
  return new PivotPage({
    title, heroName: title,
    sections: [
      {
        name: "folders", open: opener, empty: "this library is empty",
        load: async () => { const L = await getLibs(); return L.length === 1 ? Emby.folder(L[0].id, kind) : L; }, // one library: straight to its folders
        views: { key: title, kind: vk, sort: true, folders: true },
      },
      { name: "all", open: opener, load: async () => Emby.everything((await getLibs()).map(l => l.id), kind), views: { key: title, kind: vk, sort: true } },
      { name: "recent", open: opener, load: async () => Emby.everything((await getLibs()).map(l => l.id), kind, true), views: { key: title, kind: vk } },
    ],
  });
}
// what Enter does on a folder, a video or a photo
function mediaOpener(title, kind, vk) {
  const open = (x, i, list) => {
    if (x.kind === "folder") {
      return go(new PivotPage({
        title, subtitle: x.title,
        sections: [{ name: "folder", load: () => Emby.folder(x.id, kind), open, empty: "this folder is empty", views: { key: title, kind: vk, sort: true, folders: true } }],
      }));
    }
    if (x.kind === "photo") {
      const photos = list.filter(p => p.kind === "photo");
      return go(new PhotoPage(photos, Math.max(0, photos.indexOf(x)), title));
    }
    if (x.resume > 60) return go(new VideoPage(x)); // part-watched: choose resume or from the start
    go(new VodPage(x, 0));
  };
  return open;
}

/* ---------- the photo viewer ----------
   Full screen. ← → previous / next (each photo slides in, Zune style); Enter (or play) starts and
   stops a slideshow, where photos crossfade and slowly drift; ↑ ↓ show or hide the details. */
class PhotoPage extends Page {
  constructor(photos, i, section) { super(); Object.assign(this, { photos, i, section }); this.slides = false; }
  bg() { return { opacity: 0 }; }
  render() {
    const r = el("div", "photo-page");
    r.innerHTML = `<div class="ph-stage"></div>
      <div class="ph-info"><div class="ph-t"></div><div class="ph-s sc"></div></div>
      <div class="ph-hint sc">← → previous · next &nbsp;·&nbsp; enter slideshow &nbsp;·&nbsp; ↑ details</div>`;
    return r;
  }
  q(s) { return this.el.querySelector(s); }
  mounted() { this.show(0); this.info(true, 4000); }
  enter() { return done(this.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: "ease-out" })); }
  leave() { return done(this.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" })); }
  unmount() { clearInterval(this.timer); clearTimeout(this.infoTimer); super.unmount(); }
  show(dir) {
    const p = this.photos[this.i], stage = this.q(".ph-stage"), old = [...stage.children];
    const img = el("img", "ph-img"); img.alt = "";
    if (this.slides) img.style.animationName = "svdrift" + (1 + Math.floor(Math.random() * 3)); // slow drift during a slideshow
    img.onload = () => {
      if (!this.el) return;
      if (this.slides || !dir) { // crossfade
        img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: this.slides ? 1600 : 450, easing: "ease", fill: "both" });
        old.forEach(o => o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1600, fill: "forwards" }).finished.then(() => o.remove(), () => o.remove()));
      } else { // slide: the new photo comes in from the side you moved toward, the old one leaves the other way
        img.animate([{ opacity: 0, transform: `translateX(${dir * 14}%) scale(.96)` }, { opacity: 1, transform: "none" }], { duration: 520, easing: EASE, fill: "both" });
        old.forEach(o => o.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dir * 14}%) scale(.96)` }], { duration: 300, easing: EASE_IN, fill: "forwards" }).finished.then(() => o.remove(), () => o.remove()));
      }
    };
    img.onerror = () => { if (this.el) { old.forEach(o => o.remove()); stage.append(el("div", "ph-err sc", "this photo couldn't be shown")); } };
    img.src = p.full || p.img;
    stage.append(img);
    this.q(".ph-t").textContent = p.title;
    this.q(".ph-s").textContent = [homeDate(p), `${this.i + 1} of ${this.photos.length}`].filter(Boolean).join(" · ");
    // load the neighbours ahead of time, so the next press is instant
    for (const j of [this.i + 1, this.i - 1]) { const n = this.photos[(j + this.photos.length) % this.photos.length]; if (n) new Image().src = n.full || n.img; }
  }
  step(d) { this.i = (this.i + d + this.photos.length) % this.photos.length; this.show(d); }
  info(on, autoHide) {
    clearTimeout(this.infoTimer);
    this.el.classList.toggle("info", on);
    if (on && autoHide) this.infoTimer = setTimeout(() => this.el && this.el.classList.remove("info"), autoHide);
  }
  slideshow(on) {
    this.slides = on;
    clearInterval(this.timer);
    toast(on ? "slideshow" : "slideshow stopped");
    if (on) { this.info(false); this.timer = setInterval(() => this.step(1), 7000); this.step(1); }
  }
  playKey() { this.slideshow(!this.slides); return true; }
  key(k) {
    if (k === "left" || k === "right") { if (this.slides) this.slideshow(false); this.step(k === "left" ? -1 : 1); return true; }
    if (k === "ok") { this.slideshow(!this.slides); return true; }
    if (k === "up" || k === "down") { this.info(!this.el.classList.contains("info")); return true; }
    return false; // Back: return to the grid
  }
}

// a show: its seasons become the sections
async function openShow(show) {
  let seasons;
  try { seasons = await Emby.seasons(show.id); } catch (e) { return toast("couldn't load this show — " + lower(e.message)); }
  if (!seasons.length) return toast("no episodes found for this show");
  go(new PivotPage({
    title: "tv shows", subtitle: show.title,
    bg: { src: show.backdrop || show.img, opacity: 0.5 },
    sections: seasons.map(se => ({
      name: se.name, load: () => Emby.episodes(show.id, se.id), view: listView(150, ROW.episode),
      open: ep => go(new VideoPage(ep)),
    })),
  }));
}

class VideoPage extends Page {
  constructor(v) { super(); this.v = v; this.f = 0; }
  get titleKey() { return this.v.rec ? "recordings" : this.v.home ? "home videos" : this.v.type === "Episode" ? "tv shows" : "movies"; }
  render() {
    const v = this.v, ep = v.type === "Episode" && !v.rec;
    const r = el("div", "video-page" + (ep ? " ep" : ""));
    const meta = v.rec ? [v.ep, v.recording ? "recording now" : "", v.channel, v.when ? homeDate(v) : "", v.runtime ? fmtLong(v.runtime) : "", v.played ? "watched" : ""]
      : ep
      ? [v.seriesName, `season ${v.season || "?"} · episode ${v.episode || "?"}`, v.runtime ? fmtLong(v.runtime) : ""]
      : [v.year, v.runtime ? fmtLong(v.runtime) : "", v.rating, v.score ? `★ ${v.score}` : ""];
    // giant title stays the section ("MOVIES" / "TV SHOWS"); the movie or episode name sits under it in bold caps
    r.append(el("div", "sec-title z", esc(this.titleKey)),
      el("div", "alb-head zs", `<div class="an">${esc(v.title)}</div><div class="sc">${meta.filter(Boolean).map(esc).join(" · ")}</div>`));
    const pic = ep ? (v.thumb || v.img) : v.img;
    if (pic) { const p = el("img", "vid-art flip"); p.src = pic; p.alt = ""; r.append(p); }
    const info = el("div", "vid-info");
    info.append(el("div", "overview t", esc(v.overview || "no description.")));
    if (v.genres && v.genres.length) info.append(el("div", "genres t", esc(v.genres.slice(0, 4).join(" · ").toLowerCase())));
    const btns = el("div", "btn-row t");
    this.btnEls = [];
    if (v.resume > 60) this.btnEls.push(el("div", "btn", `resume ${fmtLong(v.resume)}`));
    this.btnEls.push(el("div", "btn", v.resume > 60 ? "from start" : "play"));
    if (v.people && v.people.length) this.btnEls.push(this.castBtn());
    if (v.rec) { const d = el("div", "btn", "delete"); d.dataset.id = "delete"; this.btnEls.push(d); }
    btns.append(...this.btnEls); info.append(btns);
    r.append(info);
    this.paint();
    return r;
  }
  castBtn() { const b = el("div", "btn", "cast &amp; crew"); b.dataset.id = "cast"; return b; }
  // cast & crew comes from Emby after the page opens; the button slides in once there's someone to show
  mounted() {
    const v = this.v;
    if (v.people !== undefined || !v.emby || v.home || !Emby.connected) return;
    v.people = null; // (asking)
    Emby.people(v).then(list => { v.people = list; }, () => { v.people = undefined; }).then(() => {
      if (!this.el || !v.people || !v.people.length || this.btnEls.some(b => b.dataset.id === "cast")) return;
      const b = this.castBtn(), del = this.btnEls.findIndex(x => x.dataset.id === "delete");
      if (del >= 0) { this.btnEls[del].before(b); this.btnEls.splice(del, 0, b); if (this.f >= del) this.f++; }
      else { this.btnEls[this.btnEls.length - 1].after(b); this.btnEls.push(b); }
      this.paint();
      turnIn([b], 1);
    });
  }
  paint() { this.btnEls.forEach((b, i) => b.classList.toggle("focus", i === this.f)); }
  bg() { return { src: this.v.backdrop || this.v.img || null, opacity: 0.45 }; }
  key(k) {
    if (k === "left" || k === "right") {
      this.f = clamp(this.f + (k === "left" ? -1 : 1), 0, this.btnEls.length - 1);
      if (this.sure) { this.sure = false; const d = this.btnEls.find(x => x.dataset.id === "delete"); if (d) { d.textContent = "delete"; d.classList.remove("danger"); } }
      this.paint(); return true;
    }
    if (k === "ok") {
      if (!Emby.connected) { toast("sign in to emby in settings to play this"); return true; }
      const b = this.btnEls[this.f];
      if (b.dataset.id === "cast") { go(new CastPage(this.v)); return true; }
      if (b.dataset.id === "delete") { // press twice: the first press asks
        if (!this.sure) { this.sure = true; b.textContent = "press enter again to delete"; b.classList.add("danger"); return true; }
        Emby.deleteItem(this.v.id).then(() => { DVR.touch(); toast(`deleted ${this.v.title}`); if (top() === this) back(); }, e => toast(DVR.why(e, "delete it")));
        return true;
      }
      const resume = this.v.resume > 60 && this.f === 0; // "resume 42m" is the first button when there's a place to go back to
      go(new VodPage(this.v, resume ? this.v.resume : 0));
      return true;
    }
    return false;
  }
}

// Cast & crew: round photos with the name and the part they played (or their job), the actors first.
// Same giant title as the info screen, so going here and back just zooms the rest in and out.
class CastPage extends Page {
  constructor(v) { super(); this.v = v; this.f = 0; }
  get titleKey() { return this.v.rec ? "recordings" : this.v.type === "Episode" ? "tv shows" : "movies"; }
  render() {
    const v = this.v, ep = v.type === "Episode" && v.seriesName;
    const r = el("div", "video-page cast-page");
    const sub = ep ? `cast & crew · s${v.season || "?"} e${v.episode || "?"} · ${v.title}` : "cast & crew";
    r.append(el("div", "sec-title z", esc(this.titleKey)),
      el("div", "alb-head zs", `<div class="an">${esc(ep ? v.seriesName : v.title)}</div><div class="sc">${esc(sub)}</div>`));
    const body = el("div", "cast-body");
    this.grid = Grid({ items: this.v.people || [], cols: 7, w: 220, h: 306, gap: 30, height: 650, cell: CELL.person, focus: this.f });
    body.append(this.grid.el); r.append(body);
    return r;
  }
  bg() { return { src: this.v.backdrop || this.v.img || null, opacity: 0.3 }; }
  key(k) {
    if (k === "up" || k === "down") { this.grid.move(k === "up" ? -1 : 1); this.f = this.grid.index; return true; }
    if (k === "left" || k === "right") { this.grid.moveX(k === "left" ? -1 : 1); this.f = this.grid.index; return true; }
    if (k === "ok") { // everything else of theirs in the library (not the one we came from)
      const p = this.grid.item;
      if (!p || !p.id) return true;
      const from = this.v.type === "Episode" ? this.v.seriesId : this.v.id;
      go(new ListPage({
        section: this.titleKey, title: p.name,
        sub: d => d.length ? `${d.length} more in your library` : "nothing else in your library",
        load: () => Emby.personTitles(p.id).then(l => l.filter(x => x.id !== from && x.id !== this.v.id)),
        view: posterGrid, open: openItem,
      }));
      return true;
    }
    return false;
  }
}

/* ============ tv guide ============ */
const HALF = 30 * 60e3, HOUR = 60 * 60e3;
const G = { rowH: 92, rows: 6, hourPx: 468, span: 3 * HOUR, ahead: 12 * HOUR }; // sizes must match the .gd-* styles
const gx = ms => ms / HOUR * G.hourPx;
const progTitle = p => p.title + (p.isMovie && p.year ? ` (${p.year})` : ""); // "Spaceballs (1987)"
const clock12 = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();

// made-up guide used when not signed in to Emby, so the guide can be tried anywhere
const SampleGuide = (() => {
  let s = 77; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const NAMES = ["WKRN", "WSMV", "WTVF", "PBS", "FOX", "CW", "ESPN", "CNN", "HGTV", "FOOD", "DISC", "HIST", "NATGEO", "TCM", "AMC", "COMEDY", "TOON", "WEATHER"];
  const SHOWS = ["Morning News", "Jeopardy!", "Wheel of Fortune", "Planet Earth", "Chopped", "House Hunters", "SportsCenter",
    "Seinfeld", "The Office", "Friends", "Nova", "Frontline", "Local News", "The Late Show", "Mythbusters", "Pawn Stars",
    "Diners, Drive-Ins and Dives", "Weather Now", "Casablanca", "The Matrix", "Monday Night Football"];
  let chans = null;
  return {
    channels: () => chans || (chans = NAMES.map((n, i) => ({ id: "sc" + i, name: n, number: `${2 + i * 2}.1`, img: null }))),
    programs(ids, from, to) {
      const out = [];
      for (const id of ids) {
        let t = from - Math.floor(r() * 3) * HALF;
        while (t < to) {
          const d = [1, 1, 2, 2, 2, 3, 4][Math.floor(r() * 7)] * HALF, title = SHOWS[Math.floor(r() * SHOWS.length)];
          out.push({ id: id + ":" + t, channelId: id, title, ep: r() < 0.4 ? `Episode ${1 + Math.floor(r() * 20)}` : "", start: t, end: t + d,
            overview: "A sample listing so the guide can be tried without an Emby server.", isNew: r() < 0.2, isMovie: d >= 4 * HALF, year: 1950 + Math.floor(r() * 74) });
          t += d;
        }
      }
      return out;
    },
  };
})();

class GuidePage extends PivotPage {
  get titleKey() { return "tv guide"; }
  constructor() {
    // tabs: guide (the channel grid) · movies · shows · sports. The last three list what's coming up, with
    // the side menu (← at the left edge) for layout, size and sort, and Enter for watch / record.
    super({ title: "tv guide", heroName: "tv guide", sections: [] });
    const open = p => this.openProgram(p);
    this.sections = [
      { name: "guide", data: [true], view: () => this.gridView() },
      { name: "movies", load: () => this.upcoming("movie"), views: { key: "tvmovies", kind: "tvmovie", sort: true }, open, empty: "no movies in the guide for the next two weeks" },
      { name: "shows", load: () => this.upcoming("series"), views: { key: "tvshows", kind: "tvshow", sort: true }, open, empty: "no shows in the guide this week" },
      { name: "sports", load: () => this.upcoming("sports"), views: { key: "tvsports", kind: "tvsport", sort: true }, open, empty: "no sports in the guide this week" },
    ];
    this.zone = "list"; // the guide opens on the channel grid, ready to move around (↑ from the top channel: the tabs)
    this.ci = 0; this.top = 0; this.channels = undefined; this.progs = new Map(); this.pending = new Set();
    const now = Date.now();
    this.T0 = Math.floor(now / HALF) * HALF;   // the guide starts at the current half hour…
    this.t0 = this.T0;                          // …and this is where the visible 3 hours begin
    this.ft = now;                              // "focus time": which show is picked when moving up/down
    // settings → channels → guide time span: 2, 3 or 4 hours across the same width
    const hours = clamp(Number(Prefs.get("guideSpan")) || 3, 2, 4);
    G.span = hours * HOUR; G.hourPx = 1404 / hours;
  }
  get live() { return Emby.connected; }
  render() {
    if (this.dvrLists !== DVR.changed) { // something was recorded or cancelled: the movies / shows / sports lists reload (red marks)
      this.dvrLists = DVR.changed;
      this.sections.slice(1).forEach(x => { x.data = undefined; x.loading = null; });
    }
    const r = super.render();
    r.classList.add("guide-page");
    return r;
  }
  // the channel grid (the "guide" tab): title and time of the picked show above it, then the channels and times
  gridView() {
    const r = el("div", "list gd-wrap"); r.style.height = "780px";
    this.info = el("div", "gd-info zs"); r.append(this.info); // (zs: it leaves and arrives with the header, like before)
    const head = el("div", "gd-head zs"); this.timeX = el("div", "gd-x"); head.append(this.timeX); r.append(head);
    const chans = el("div", "gd-chans"); this.chY = el("div", "gd-y"); chans.append(this.chY);
    const grid = el("div", "gd-grid"); this.gridX = el("div", "gd-x"); this.gridY = el("div", "gd-y");
    this.nowLine = el("div", "gd-now");
    this.gridX.append(this.gridY, this.nowLine); grid.append(this.gridX);
    this.msg = el("div", "gd-msg t");
    r.append(chans, grid, this.msg);
    if (this.channels === undefined) this.msg.textContent = "loading the guide…";
    else if (this.channels && !this.live) { this.msg.textContent = "sample guide — sign in to emby in settings to see your channels"; this.msg.classList.add("note"); }
    this.renderTimes();
    if (this.channels) this.renderRows();
    this.layout(false);
    const page = this;
    return {
      el: r, message: false,
      get index() { return page.ci; },
      get atTop() { return page.ci === 0; },
      get item() { const ch = page.channels && page.channels[page.ci]; return ch ? page.progAt(ch, page.ft) : null; }, // (voice: what's highlighted)
      move() {}, moveX() { return true; },
    };
  }
  // tv guide → movies / shows / sports: everything airing soon on your channels, one entry per movie, show or game
  async upcoming(kind) {
    if (!this.live) throw new Error("sign in to emby in settings to see what's coming up");
    this.allChans = this.allChans || Emby.channels();
    const [list, chans] = await Promise.all([Emby.upcoming(kind, kind === "movie" ? 14 : 7), this.allChans]);
    const byId = new Map(chans.map(c => [c.id, c])), hidden = new Set(Prefs.get("chHidden") || []), now = Date.now();
    const seen = new Map();
    for (const p of list.sort((a, b) => a.start - b.start)) {
      if (hidden.has(p.channelId) || p.end <= now || /^paid program/i.test(p.title)) continue;
      p.ch = byId.get(p.channelId) || { id: p.channelId, name: "", number: "", img: null };
      const key = kind === "movie" ? p.title + "|" + p.year : kind === "sports" ? p.title + "|" + p.ep : p.title;
      const had = seen.get(key);
      if (!had) { p.airings = 1; seen.set(key, p); }
      else { had.airings++; if (p.timerId) had.anyRec = true; }
    }
    return [...seen.values()];
  }
  openProgram(p) {
    const ch = (this.channels || []).find(c => c.id === p.channelId) || p.ch;
    go(new ProgramPage(this, ch, p));
  }
  mounted() {
    if (this.channels && this.dvrSeen !== DVR.changed) { // recordings changed while you were away: refresh the marks
      this.dvrSeen = DVR.changed;
      if (this.live) { this.progs.clear(); this.pending && this.pending.clear(); this.ensurePrograms(); }
    }
    this.dvrSeen = DVR.changed;
    if (this.channels === undefined) {
      Promise.resolve().then(() => this.live ? Emby.channels() : SampleGuide.channels())
        .then(c => { this.channels = arrangeChannels(c); }, e => { this.channels = null; this.err = e.message; })
        .then(() => {
          if (!this.el) return;
          if (!this.channels) { this.msg.textContent = "couldn't load the channels — " + lower(this.err); return; }
          if (!this.channels.length) { this.msg.textContent = "no live tv channels found on your emby server."; return; }
          this.msg.textContent = this.live ? "" : "sample guide — sign in to emby in settings to see your channels";
          this.msg.classList.toggle("note", !this.live);
          // tv playing? start on that channel (a few rows down, so the ones above it show too)
          // tv off: settings → channels → start on last channel puts the highlight on the one you watched last
          const lastId = Live.active && Live.ch ? Live.ch.id : Prefs.get("lastCh") && Prefs.get("lastChId");
          const on = lastId ? this.channels.findIndex(c => c.id === lastId) : -1;
          if (on >= 0) { this.ci = on; this.top = Math.max(0, Math.min(on - 2, this.channels.length - G.rows)); }
          this.renderRows(); this.layout(false);
          turnIn(qa(this.el, ".gd-row, .gd-ch"), 1, { stagger: 30, dur: 480 });
          this.ensurePrograms();
        });
    } else this.ensurePrograms();
    clearInterval(this.nowTimer);
    this.nowTimer = setInterval(() => { if (!this.el) return clearInterval(this.nowTimer); this.renderRows(); this.layout(false); }, 30e3);
  }
  // fetch listings for the channels around what's on screen, 20 channels at a time
  ensurePrograms() {
    if (!this.channels) return;
    const lo = Math.max(0, this.top - 3), hi = Math.min(this.channels.length, this.top + G.rows + 8);
    const need = this.channels.slice(lo, hi).map(c => c.id).filter(id => !this.progs.has(id) && !this.pending.has(id));
    for (let i = 0; i < need.length; i += 20) {
      const ids = need.slice(i, i + 20);
      ids.forEach(id => this.pending.add(id));
      const from = this.T0, to = this.T0 + G.ahead;
      Promise.resolve().then(() => this.live ? Emby.programs(ids, from, to) : SampleGuide.programs(ids, from, to))
        .catch(() => [])
        .then(list => {
          ids.forEach(id => { this.pending.delete(id); this.progs.set(id, []); });
          list.forEach(p => { if (this.progs.has(p.channelId)) this.progs.get(p.channelId).push(p); });
          ids.forEach(id => this.progs.get(id).sort((a, b) => a.start - b.start));
          if (this.el) this.renderRows();
        });
    }
  }
  progAt(ch, t) {
    const ps = this.progs.get(ch.id) || [];
    return ps.find(p => p.start <= t && p.end > t) || ps.find(p => p.start > t) || ps[ps.length - 1] || null;
  }
  renderTimes() {
    this.timeX.innerHTML = "";
    for (let t = this.T0; t < this.T0 + G.ahead; t += HALF) {
      const e = el("div", "gd-time", esc(clock12(t)));
      e.style.left = gx(t - this.T0) + "px";
      this.timeX.append(e);
    }
  }
  renderRows() {
    if (!this.channels || !this.channels.length) return;
    const now = Date.now(), lo = Math.max(0, this.top - 2), hi = Math.min(this.channels.length, this.top + G.rows + 2);
    const focusCh = this.channels[this.ci], focusP = this.progAt(focusCh, this.ft);
    this.gridY.innerHTML = ""; this.chY.innerHTML = "";
    for (let i = lo; i < hi; i++) {
      const ch = this.channels[i], y = i * G.rowH + "px";
      const c = el("div", "gd-ch t" + (i === this.ci ? " focus" : ""),
        `${ch.img ? imgTag(ch.img, "logo") : ""}${guideNums() ? `<div class="num">${esc(ch.number)}</div>` : ""}<div class="nm">${esc(ch.name)}</div>`);
      c.style.top = y; this.chY.append(c);
      const row = el("div", "gd-row t"); row.style.top = y;
      const ps = this.progs.get(ch.id);
      if (!ps || !ps.length) {
        const e = el("div", "gd-cell empty", ps ? "no guide information" : "loading…");
        e.style.left = gx(this.t0 - this.T0) + "px"; e.style.width = gx(G.span) - 6 + "px";
        row.append(e);
      } else for (const p of ps) {
        if (p.end <= this.T0 || p.start >= this.T0 + G.ahead) continue;
        const s = Math.max(p.start, this.T0), e = Math.min(p.end, this.T0 + G.ahead);
        const onAir = p.start <= now && p.end > now;
        const mark = p.timerId ? (onAir ? `<span class="recmark now">rec</span>` : `<span class="recmark${p.seriesTimerId ? " series" : ""}"></span>`) : "";
        const cell = el("div", "gd-cell" + (p === focusP && i === this.ci ? " focus" : "") + (onAir ? " on" : "") + (p.timerId ? " rec" : ""),
          `${mark}<div class="pt">${esc(p.title)}</div><div class="ps">${esc(p.ep || clock12(p.start))}${p.isNew ? ` <b>new</b>` : ""}</div>`);
        cell.style.left = gx(s - this.T0) + "px";
        cell.style.width = Math.max(8, gx(e - s) - 6) + "px";
        // keep the title readable when the show began before the visible window
        const hidden = gx(Math.max(0, this.t0 - s));
        if (hidden > 0) cell.style.paddingLeft = Math.min(hidden + 18, Math.max(18, gx(e - s) - 140)) + "px";
        row.append(cell);
      }
      this.gridY.append(row);
    }
    this.nowLine.style.left = gx(now - this.T0) + "px";
    this.nowLine.style.display = now >= this.T0 && now < this.T0 + G.ahead ? "" : "none";
    this.showInfo(focusCh, focusP);
  }
  showInfo(ch, p) {
    if (!ch) return;
    const now = Date.now();
    const flags = p ? [p.isNew ? "new" : "", p.isLive ? "live" : "", p.isMovie ? "movie" : "", p.start <= now && p.end > now ? "on now" : ""].filter(Boolean) : [];
    this.info.innerHTML = p
      ? `<div class="it">${esc(p.title)}${p.isMovie && p.year ? `<span> (${p.year})</span>` : ""}${p.ep ? `<span> · ${esc(p.ep)}</span>` : ""}</div>
         <div class="sc">${esc(guideCh(ch))} · ${clock12(p.start)} – ${clock12(p.end)}${flags.length ? " · " + flags.join(" · ") : ""}</div>`
      : `<div class="it">${esc(ch.name)}</div><div class="sc">${guideNums() && ch.number ? esc(ch.number) + " · " : ""}no guide information</div>`;
  }
  layout(anim) {
    const tr = anim ? `transform 420ms ${EASE}` : "none";
    const x = `translateX(${-gx(this.t0 - this.T0)}px)`, y = `translateY(${-this.top * G.rowH}px)`;
    this.timeX.style.transition = this.gridX.style.transition = tr;
    this.chY.style.transition = this.gridY.style.transition = tr;
    this.timeX.style.transform = this.gridX.style.transform = x;
    this.chY.style.transform = this.gridY.style.transform = y;
  }
  key(k) {
    if (this.pv === 0 && this.zone === "list") {
      if (k === "up" && (!this.channels || !this.channels.length || this.ci === 0)) { this.zone = "head"; this.paintZone(); return true; }
      return this.gridKey(k);
    }
    return super.key(k);
  }
  // slide the 3-hour window so time t is comfortably in view
  showTime(t) {
    const max = this.T0 + G.ahead - G.span;
    if (t < this.t0) this.t0 = Math.floor(t / HALF) * HALF;
    else if (t >= this.t0 + G.span - HALF) this.t0 = Math.floor(t / HALF) * HALF - HALF;
    this.t0 = clamp(this.t0, this.T0, max);
  }
  gridKey(k) {
    if (!this.channels || !this.channels.length) return false;
    const ch = this.channels[this.ci], ps = this.progs.get(ch.id) || [], cur = this.progAt(ch, this.ft);
    if (k === "left" || k === "right") {
      const d = k === "right" ? 1 : -1;
      if (ps.length && cur) {
        const n = ps[ps.indexOf(cur) + d];
        if (!n || n.start >= this.T0 + G.ahead || n.end <= this.T0) return true;
        this.ft = Math.max(n.start, this.T0);
        this.showTime(d > 0 ? this.ft : Math.max(n.start, this.T0));
      } else {
        this.ft = clamp(this.ft + d * HALF, this.T0, this.T0 + G.ahead - 1);
        this.showTime(this.ft);
      }
    } else if (k === "up" || k === "down") {
      const n = clamp(this.ci + (k === "up" ? -1 : 1), 0, this.channels.length - 1);
      if (n === this.ci) return true;
      this.ci = n;
      if (this.ci < this.top) this.top = this.ci;
      if (this.ci >= this.top + G.rows) this.top = this.ci - G.rows + 1;
      this.ensurePrograms();
    } else if (k === "ok") {
      // settings → playback → guide enter: show the show's info first, or tune straight away
      if (Prefs.get("guideOk") === "tune" && Emby.connected) go(new LivePage(this, this.ci));
      else go(new ProgramPage(this, ch, cur));
      return true;
    } else return false;
    this.renderRows(); this.layout(true);
    return true;
  }
}

/* ============ a show picked in the guide: details + watch / back ============ */
class ProgramPage extends Page {
  constructor(guide, ch, p) { super(); Object.assign(this, { guide, ch, p }); this.f = 0; }
  get titleKey() { return "tv guide"; }
  render() {
    const { ch, p } = this, now = Date.now();
    const onNow = p && p.start <= now && p.end > now;
    const watching = Live.isOn(ch);
    const when = !p ? "" : onNow ? `on now · ${fmtLong((p.end - now) / 1000)} left`
      : p.start > now ? `starts in ${fmtLong((p.start - now) / 1000)}` : "already aired";
    const r = el("div", "program-page");
    r.append(el("div", "sec-title z", "tv guide"),
      el("div", "alb-head zs", `<div class="an">${esc(p ? progTitle(p) : ch.name)}</div><div class="sc">${
        [esc(guideCh(ch)), p ? `${clock12(p.start)} – ${clock12(p.end)}` : "", when, watching ? "watching" : ""].filter(Boolean).join(" · ")}</div>`));
    // Emby's guide pictures are usually portrait posters; the frame takes the picture's own shape
    // (portrait unless Emby says it's wide), and corrects itself once the picture has loaded
    r.classList.toggle("portrait", !!(p && p.img && !(p.aspect > 1)));
    const pic = el("div", "pg-art flip");
    pic.innerHTML = p && p.img ? imgTag(p.img) : ch.img ? imgTag(ch.img, "logo") : (guideNums() ? `<div class="num">${esc(ch.number)}</div>` : `<div class="num name">${esc(ch.name)}</div>`);
    const im = pic.querySelector("img:not(.logo)");
    if (im) im.addEventListener("load", () => r.classList.toggle("portrait", im.naturalWidth < im.naturalHeight));
    r.append(pic);
    const info = el("div", "vid-info pg-info");
    if (p && p.ep) info.append(el("div", "pg-ep t", esc(p.ep)));
    info.append(el("div", "overview t", esc((p && p.overview) || "no description.")));
    const flags = p ? [p.isNew ? "new" : "", p.isLive ? "live" : "", p.isMovie ? "movie" : "", ...(p.genres || []).slice(0, 3)].filter(Boolean) : [];
    if (flags.length) info.append(el("div", "genres t", esc(flags.join(" · ").toLowerCase())));
    this.btnRow = el("div", "btn-row t"); info.append(this.btnRow);
    this.renderButtons();
    r.append(info);
    return r;
  }
  // watch · record (or don't record) · record series (or series options) · back
  renderButtons() {
    const { ch, p } = this, now = Date.now(), onNow = p && p.start <= now && p.end > now, watching = Live.isOn(ch);
    const list = [["watch", onNow || !p || watching ? "watch" : `watch ${ch.name} now`]];
    if (watching) list.push(["stop", "stop"]);
    if (p && p.end > now && Emby.connected) {
      list.push(["rec", p.timerId ? "don't record" : onNow ? "record the rest" : "record"]);
      if (p.isSeries || p.seriesTimerId) list.push(["series", p.seriesTimerId ? "series options" : "record series"]);
    }
    list.push(["back", "back"]);
    const keep = this.btnEls && this.btnEls[this.f] && this.btnEls[this.f].dataset.id;
    this.btnEls = list.map(([id, label]) => { const b = el("div", "btn" + (id === "rec" && p && p.timerId ? " rec-on" : ""), esc(label)); b.dataset.id = id; return b; });
    this.btnRow.innerHTML = ""; this.btnRow.append(...this.btnEls);
    if (keep) this.f = Math.max(0, this.btnEls.findIndex(b => b.dataset.id === keep));
    this.f = clamp(this.f, 0, this.btnEls.length - 1);
    this.paint();
  }
  paint() { this.btnEls.forEach((b, i) => b.classList.toggle("focus", i === this.f)); }
  bg() { return { src: (this.p && this.p.img) || null, opacity: 0.3 }; }
  key(k) {
    if (k === "left" || k === "right") { this.f = clamp(this.f + (k === "left" ? -1 : 1), 0, this.btnEls.length - 1); this.paint(); return true; }
    if (k === "ok") {
      const id = this.btnEls[this.f].dataset.id;
      if (id === "back") { back(); return true; }
      if (id === "stop") { Live.stop(); toast("stopped " + this.ch.name); back(); return true; }
      if (id === "rec") { DVR.toggle(this.p).then(() => this.el && this.renderButtons()); return true; }
      if (id === "series") {
        if (this.p.seriesTimerId) go(new SeriesPage(this.p.seriesTimerId));
        else DVR.series(this.p).then(() => this.el && this.renderButtons());
        return true;
      }
      if (!Emby.connected) { toast("sign in to emby in settings to watch live tv"); return true; }
      let g = this.guide, i = (g.channels || []).indexOf(this.ch);
      if (i < 0) { const held = new GuidePage(); held.channels = channelsWith(g.channels || [], this.ch); g = held; i = g.channels.indexOf(this.ch); } // (a hidden channel)
      go(new LivePage(g, i), { replace: true }); // Back from the TV returns to the guide
      return true;
    }
    return false;
  }
}

/* ============ recording (Emby's DVR) ============
   Emby does the recording; the app schedules, shows and plays. From the guide: record one airing or
   a whole series (series options: new episodes only, any channel, how many to keep). The RECORDINGS
   menu has recent · shows · movies · scheduled · series. */
const DVR = {
  changed: 0, // bumped whenever something is scheduled, cancelled or deleted (lists then reload)
  touch() { this.changed = Date.now(); quick.key = null; quick.rows = null; }, // (the history shelf reloads too)
  why(e, doing) {
    if (e && (e.status === 401 || e.status === 403)) return "this emby account isn't allowed to manage recordings — in emby: dashboard → users → (you) → allow managing live tv recordings";
    return `couldn't ${doing} — ` + lower((e && e.message) || "unknown problem");
  },
  // after a change, ask Emby what's now set for this show
  async sync(p) {
    const t = (await Emby.timers()).find(t => t.programId === p.id);
    p.timerId = t ? t.id : null;
    if (t && t.seriesTimerId) p.seriesTimerId = t.seriesTimerId;
  },
  async toggle(p) {
    if (!p) return;
    try {
      if (p.timerId) {
        await Emby.cancelTimer(p.timerId); p.timerId = null;
        toast(`won't record ${p.title}`);
      } else {
        await Emby.record(p.id); await this.sync(p);
        const now = Date.now();
        toast(p.start <= now ? `recording ${p.title}` : `will record ${p.title} · ${clock12(p.start)}`);
      }
      this.touch();
    } catch (e) { toast(this.why(e, "change the recording")); }
  },
  async series(p) {
    try {
      await Emby.recordSeries(p.id, { RecordNewOnly: true, RecordAnyChannel: false });
      await this.sync(p);
      if (!p.seriesTimerId) { const st = (await Emby.seriesTimers()).find(s => s.title === p.title); if (st) p.seriesTimerId = st.id; }
      toast(`recording new episodes of ${p.title}`);
      this.touch();
    } catch (e) { toast(this.why(e, "record the series")); }
  },
};

// a recording tile: thumbnail with its length (or a red REC while it's still recording), title, then episode / channel · date
CELL.rec = x => el("div", "media video rec", `<div class="pic">${x.thumb || x.img ? imgTag(x.thumb || x.img) : `<span class="noimg"></span>`}${
  x.group ? `<span class="len">${x.count} recording${x.count === 1 ? "" : "s"}</span>` : x.recording ? `<span class="len live">rec</span>` : x.runtime ? `<span class="len">${fmtT(x.runtime)}</span>` : ""}${
  !x.group && x.resume && x.runtime ? `<span class="seen"><i style="width:${Math.min(100, x.resume / x.runtime * 100)}%"></i></span>` : ""}</div><div class="mcap"><b>${esc(x.title)}</b><span>${
  esc(x.group ? (x.newest ? "newest " + ago(x.newest) : "") : [x.ep, x.channel, x.when ? homeDate(x) : "", x.played ? "watched" : ""].filter(Boolean).join(" · "))}</span></div>`);
ROW.rec = x => el("div", "r-media video", `<div class="pic">${x.thumb || x.img ? imgTag(x.thumb || x.img) : ""}</div><div class="tx"><div class="t1">${esc(x.ep && !x.group ? `${x.title} · ${x.ep}` : x.title)}</div><div class="t2 sc">${
  esc(x.group ? `${x.count} recordings` : [x.recording ? "recording now" : "", x.channel, x.when ? homeDate(x) : "", x.runtime ? fmtLong(x.runtime) : "", x.played ? "watched" : x.resume > 60 ? "in progress" : ""].filter(Boolean).join(" · "))}</div></div>`);
VIEW_KINDS.rec = {
  layouts: [["posters", "thumbnails"], ["list", "list"]],
  sorts: [["date:desc", "newest first"], ["date:asc", "oldest first"], ["title:asc", "name a–z"]],
  grid: { s: { cols: 6, w: 262, h: 214, gap: 22 }, m: { cols: 5, w: 318, h: 248, gap: 24 }, l: { cols: 3, w: 540, h: 372, gap: 30 } },
  cell: CELL.rec, row: ROW.rec, rowH: { s: 96, m: 130, l: 180 },
};
// scheduled recordings and series rules, as text rows
const dayWord = t => {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
  return diff === 0 ? (d.getHours() >= 17 ? "tonight" : "today") : diff === 1 ? "tomorrow" : d.toLocaleDateString([], { weekday: "long" }).toLowerCase();
};
ROW.timer = t => el("div", "r-media", `<div class="pic">${t.img ? imgTag(t.img) : ""}</div><div class="tx"><div class="t1">${esc(t.title)}${t.ep ? ` · ${esc(t.ep)}` : ""}</div><div class="t2 sc">${
  esc([t.status === "InProgress" ? "recording now" : `${dayWord(t.start)} ${clock12(t.start)}`, t.channel, t.seriesTimerId ? "series" : ""].filter(Boolean).join(" · "))}</div></div>`);
ROW.series = s => el("div", "r-media", `<div class="pic">${s.img ? imgTag(s.img) : ""}</div><div class="tx"><div class="t1">${esc(s.title)}</div><div class="t2 sc">${
  esc([s.newOnly ? "new episodes" : "all airings", s.anyChannel ? "any channel" : s.channel, s.keep ? `keeps ${s.keep}` : "keeps all"].filter(Boolean).join(" · "))}</div></div>`);

// what Enter does on a recording: part-watched or finished ones show their page (resume / start / delete); others play
function playRecording(x) {
  if (x.group) return go(recShowPage(x));
  go(new VideoPage(x));
}
function recordingsPage() {
  let all = null;
  const load = () => (all = all || Emby.recordings());
  const page = new PivotPage({
    title: "recordings", heroName: "recordings",
    sections: [
      { name: "recent", load, views: { key: "recordings", kind: "rec", sort: true }, open: playRecording, empty: "nothing recorded yet — record from the tv guide" },
      {
        name: "shows", views: { key: "recordings", kind: "rec", sort: true }, open: playRecording, empty: "no recorded shows yet",
        load: async () => {
          const by = new Map();
          for (const r of await load()) if (!r.isMovie && r.seriesName) {
            if (!by.has(r.seriesName)) by.set(r.seriesName, []);
            by.get(r.seriesName).push(r);
          }
          return [...by].map(([name, eps]) => ({ id: "show:" + name, group: true, title: name, eps, count: eps.length, newest: eps[0].when, when: eps[0].when, thumb: eps[0].thumb, img: eps[0].img }));
        },
      },
      { name: "movies", load: async () => (await load()).filter(r => r.isMovie), views: { key: "recordings", kind: "rec", sort: true }, open: playRecording, empty: "no recorded movies yet" },
      { name: "scheduled", load: () => Emby.timers(), view: listView(130, ROW.timer), open: t => go(new TimerPage(t)), empty: "nothing scheduled — record from the tv guide" },
      { name: "series", load: () => Emby.seriesTimers(), view: listView(130, ROW.series), open: s => go(new SeriesPage(s.id)), empty: "no series set to record" },
    ],
  });
  // back from a recording that was deleted, or after scheduling something: the lists reload
  page.stale = () => { const c = page.dvrSeen !== DVR.changed; page.dvrSeen = DVR.changed; if (c) all = null; return c; };
  return page;
}
const recShowPage = g => new PivotPage({
  title: "recordings", subtitle: g.title, bg: g.img ? { src: g.img, opacity: 0.35 } : undefined,
  sections: [{ name: "episodes", load: () => g.eps, views: { key: "recordings", kind: "rec", sort: true }, open: playRecording, empty: "no recordings" }],
});

/* ---------- small pages: one scheduled recording, and a series' options ---------- */
class TimerPage extends Page {
  constructor(t) { super(); this.t = t; this.f = 0; }
  get titleKey() { return "recordings"; }
  render() {
    const t = this.t, r = el("div", "sub-page action-page");
    r.append(el("div", "sec-title z", "recordings"),
      el("div", "alb-head zs", `<div class="an">${esc(t.title)}</div><div class="sc">${esc([t.ep, `${dayWord(t.start)} ${clock12(t.start)} – ${clock12(t.end)}`, t.channel].filter(Boolean).join(" · "))}</div>`));
    const btns = el("div", "btn-row t act-btns");
    this.btnEls = [["cancel", t.seriesTimerId ? "skip this one" : "don't record"], ...(t.seriesTimerId ? [["series", "series options"]] : []), ["back", "back"]]
      .map(([id, label]) => { const b = el("div", "btn", esc(label)); b.dataset.id = id; return b; });
    btns.append(...this.btnEls); r.append(btns);
    this.paint();
    return r;
  }
  paint() { this.btnEls.forEach((b, i) => b.classList.toggle("focus", i === this.f)); }
  bg() { return { src: this.t.img || null, opacity: 0.3 }; }
  key(k) {
    if (k === "left" || k === "right") { this.f = clamp(this.f + (k === "left" ? -1 : 1), 0, this.btnEls.length - 1); this.paint(); return true; }
    if (k !== "ok") return false;
    const id = this.btnEls[this.f].dataset.id;
    if (id === "back") back();
    else if (id === "series") go(new SeriesPage(this.t.seriesTimerId));
    else if (id === "cancel") this.cancel();
    return true;
  }
  async cancel() {
    try { await Emby.cancelTimer(this.t.id); DVR.touch(); toast(`won't record ${this.t.title}`); if (top() === this) back(); }
    catch (e) { toast(DVR.why(e, "cancel it")); }
  }
}
class SeriesPage extends Page {
  constructor(id) { super(); this.id = id; this.f = 0; this.st = null; }
  get titleKey() { return "recordings"; }
  render() {
    const r = el("div", "sub-page action-page");
    r.append(el("div", "sec-title z", "recordings"), this.head = el("div", "alb-head zs", `<div class="an">series</div><div class="sc">loading…</div>`));
    this.body = el("div", "act-body"); r.append(this.body);
    if (this.st) this.build();
    return r;
  }
  async mounted() {
    if (this.st) return;
    try { this.st = (await Emby.seriesTimers()).find(s => s.id === this.id); } catch (e) { toast(DVR.why(e, "load the series")); }
    if (!this.el) return;
    if (!this.st) { this.head.querySelector(".sc").textContent = "this series isn't set to record any more"; return; }
    this.build();
    turnIn(visibleT(this.body), 1, { stagger: 40 });
  }
  options() {
    const raw = this.st.raw;
    return [
      { id: "new", label: "episodes", value: raw.RecordNewOnly ? "new ones only" : "every airing", toggle: () => { raw.RecordNewOnly = !raw.RecordNewOnly; } },
      { id: "chan", label: "channel", value: raw.RecordAnyChannel ? "any channel" : (raw.ChannelName || "this channel"), toggle: () => { raw.RecordAnyChannel = !raw.RecordAnyChannel; } },
      { id: "keep", label: "keep", value: raw.KeepUpTo ? `the last ${raw.KeepUpTo}` : "all of them", toggle: () => { const k = [0, 5, 10, 20]; raw.KeepUpTo = k[(k.indexOf(raw.KeepUpTo || 0) + 1) % k.length]; } },
    ];
  }
  build() {
    this.head.innerHTML = `<div class="an">${esc(this.st.title)}</div><div class="sc">series recording · enter changes an option</div>`;
    this.body.innerHTML = "";
    this.items = this.options().map(o => {
      const row = el("div", "opt-row t", `<div class="lab">${esc(o.label)}</div><div class="btn">${esc(o.value)}</div>`);
      row.opt = o; this.body.append(row); return row;
    });
    const btns = el("div", "btn-row t act-btns");
    for (const [id, label] of [["stop", "stop recording this series"], ["back", "back"]]) {
      const b = el("div", "btn", esc(label)); b.dataset.id = id; btns.append(b); this.items.push(b);
    }
    this.body.append(btns);
    this.paint();
  }
  paint() { (this.items || []).forEach((e, i) => e.classList.toggle("focus", i === this.f)); }
  bg() { return { src: (this.st && this.st.img) || null, opacity: 0.3 }; }
  // ↑ ↓ move through the options and then the buttons; Enter (or ← →) changes an option
  key(k) {
    if (!this.items) return k !== "back";
    const it = this.items[this.f];
    if (k === "up" || k === "down") { this.f = clamp(this.f + (k === "up" ? -1 : 1), 0, this.items.length - 1); this.paint(); return true; }
    if (it.opt && (k === "ok" || k === "left" || k === "right")) { this.change(it.opt); return true; }
    if (!it.opt && (k === "left" || k === "right")) { const j = this.f + (k === "left" ? -1 : 1); if (this.items[j] && !this.items[j].opt) { this.f = j; this.paint(); } return true; }
    if (k === "ok") {
      if (it.dataset.id === "back") back();
      else if (it.dataset.id === "stop") this.stop();
      return true;
    }
    return k !== "back";
  }
  async change(opt) {
    opt.toggle();
    const f = this.f; this.build(); this.f = f; this.paint();
    try { await Emby.updateSeries(this.st.raw); DVR.touch(); } catch (e) { toast(DVR.why(e, "change the series")); }
  }
  async stop() {
    try { await Emby.cancelSeries(this.st.id); DVR.touch(); toast(`stopped recording ${this.st.title}`); if (top() === this) back(); }
    catch (e) { toast(DVR.why(e, "stop the series")); }
  }
}

/* ============ live tv engine ============
   The video lives in its own layer (#vlayer) under the menus, so it keeps playing while you browse:
   - "full":   the TV screen itself
   - "behind": full screen behind the menus, dimmed so they stay readable
   - "corner": a small window in the lower right, above the menus
   Which background style is used is a setting (settings -> tv behind menus). */
/* ============ the Shield's own video player ============
   On the Shield (the Android app) videos don't play in the page: the Shield's player (ExoPlayer)
   plays them, passing Atmos / DTS / TrueHD to the receiver and HDR to the TV. Each picture is a
   video surface UNDER the page. nativeVideo() makes a stand-in for a <video> element (same commands:
   src, play, pause, currentTime, volume, events…) that sits where the picture should be; every
   frame the page tells the Shield where each stand-in is (so pictures follow the app's animations)
   and cuts a see-through window into the background there. */
const NV = {
  els: new Map(), n: 0, running: false, sent: "",
  state(list) { list.forEach(s => { const e = this.els.get(s.id); if (e) e._nvState(s); }); },
  event(id, type, data) { const e = this.els.get(id); if (e) e._nvEvent(type, data); },
  start() { if (!this.running) { this.running = true; requestAnimationFrame(() => this.frame()); } },
  frame() {
    const out = [], holes = [];
    for (const [id, e] of this.els) {
      const r = e.getBoundingClientRect();
      let a = e.isConnected ? 1 : 0;
      for (let n = e; n && a > 0 && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === "hidden" || cs.display === "none") a = 0; else a *= +cs.opacity;
      }
      out.push([id, +r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1), +a.toFixed(2)]);
      if (a > 0.02 && r.width > 1) holes.push(r);
    }
    const j = JSON.stringify(out);
    if (j !== this.sent) { this.sent = j; NATIVE.videoLayout(j); this.cut(holes); }
    if (this.els.size) requestAnimationFrame(() => this.frame()); else { this.running = false; this.sent = ""; this.cut([]); }
  },
  // the background picture gets see-through windows where the videos are (everything else in the
  // page is already transparent there)
  cut(rs) {
    const bg = document.getElementById("bg");
    if (!bg) return;
    if (!rs.length) { bg.style.clipPath = ""; return; }
    const sr = $stage.getBoundingClientRect(), k = sr.width / 1920 || 1, f = n => +n.toFixed(1);
    const d = rs.map(r => `M${f((r.x - sr.x) / k)} ${f((r.y - sr.y) / k)}h${f(r.width / k)}v${f(r.height / k)}h${f(-r.width / k)}z`).join("");
    bg.style.clipPath = `path(evenodd, "M-10 -10H1930V1090H-10Z${d}")`;
  },
};
if (NATIVE) {
  window.__nv = NV;
  document.documentElement.classList.add("native");
  try { NATIVE.matchFrameRate(Prefs.get("fps") !== "off"); } catch {}
}
// vod: a movie / episode / recording (the TV may switch to its frame rate), not live tv
function nativeVideo(cls, vod) {
  const e = el("div", cls + " nv"), id = ++NV.n;
  let src = "", paused = true, pos = 0, at = 0, playing = false, dur = NaN, buf = 0, liveEnd = null, vol = 1, muted = false, ended = false, w = 0, h = 0;
  const track = { kind: "captions", label: "cc1", language: "en", mode: "hidden", activeCues: [], oncuechange: null };
  const fire = t => e.dispatchEvent(new Event(t));
  const sendVol = () => { if (src) NATIVE.videoVolume(id, muted ? 0 : vol); };
  const range = (a, b) => ({ length: b > a ? 1 : 0, start: () => a, end: () => b });
  const now = () => playing ? pos + (performance.now() - at) / 1000 : pos;
  const release = () => {
    if (!src) return;
    NATIVE.videoRelease(id); NV.els.delete(id);
    src = ""; paused = true; playing = false; pos = 0; dur = NaN; buf = 0; liveEnd = null; ended = false; w = h = 0;
    track.activeCues = []; if (track.oncuechange) track.oncuechange();
  };
  e._nvState = s => {
    pos = s.pos; at = performance.now(); playing = s.playing; buf = s.buf || 0; w = s.w; h = s.h;
    liveEnd = s.live ? s.liveEnd : null;
    dur = s.live ? Infinity : s.dur || NaN;
    if (!s.pwr && !paused && !ended) { paused = true; fire("pause"); } // paused by the Shield (app sent to the background)
    fire("timeupdate");
  };
  e._nvEvent = (type, data) => {
    if (type === "cues") {
      track.activeCues = (data.cues || []).map(c => ({ text: c.text, line: c.line, startTime: performance.now() / 1000 }));
      if (track.oncuechange) track.oncuechange();
      return;
    }
    if (type === "ended") { ended = true; playing = false; }
    if (type === "playing") ended = false;
    if (type === "error") {
      const msg = lower(String((data && data.message) || "").replace(/^ERROR_CODE_/, "").replace(/_/g, " "));
      e.error = { message: msg };
      if (e._onFail) e._onFail(msg);
    }
    if (type === "loadedmetadata") fire("durationchange");
    fire(type);
  };
  Object.defineProperties(e, {
    native: { value: true },
    src: {
      get: () => src,
      set: u => {
        if (!u) return release();
        src = String(u); paused = true; ended = false; pos = 0; dur = NaN;
        NV.els.set(id, e); NV.start();
        NATIVE.videoLoad(id, src, !!vod); sendVol();
      },
    },
    paused: { get: () => paused },
    ended: { get: () => ended },
    currentTime: {
      get: () => { const t = now(); return isFinite(dur) ? Math.min(t, dur) : t; },
      set: t => { t = Math.max(0, +t || 0); pos = t; at = performance.now(); ended = false; if (src) NATIVE.videoSeek(id, t); fire("seeking"); },
    },
    duration: { get: () => dur },
    seekable: { get: () => liveEnd != null ? range(0, liveEnd) : range(0, isFinite(dur) ? dur : 0) },
    buffered: { get: () => range(0, buf) },
    volume: { get: () => vol, set: v => { vol = Math.max(0, Math.min(1, +v || 0)); sendVol(); } },
    muted: { get: () => muted, set: m => { muted = !!m; sendVol(); } },
    textTracks: { value: [track] },
    videoWidth: { get: () => w },
    videoHeight: { get: () => h },
    readyState: { get: () => (src && (playing || pos > 0 || isFinite(dur)) ? 4 : 0) },
  });
  e.play = () => { paused = false; if (src) NATIVE.videoPlay(id); fire("play"); return Promise.resolve(); };
  e.pause = () => { if (paused) return; paused = true; if (src) NATIVE.videoPause(id); fire("pause"); };
  e.load = () => {};
  e.canPlayType = () => "probably";
  e.removeAttribute = n => { if (n === "src") release(); else Element.prototype.removeAttribute.call(e, n); };
  e.remove = () => { release(); Element.prototype.remove.call(e); };
  return e;
}

const Live = {
  active: false, guide: null, i: 0, gen: 0, hls: null, stream: null, statusText: "", recovered: false,
  get ch() { return this.guide && this.guide.channels ? this.guide.channels[this.i] : null; },
  isOn(ch) { return this.active && !!ch && !!this.ch && this.ch.id === ch.id; }, // match by id: each guide visit loads fresh channel objects
  get bgMode() { try { return localStorage.getItem("mc.bgVideo") || "behind"; } catch { return "behind"; } },
  set bgMode(v) { try { localStorage.setItem("mc.bgVideo", v); } catch {} this.place(); },
  init() {
    this.layer = el("div", "vlayer off"); this.layer.id = "vlayer";
    this.video = newVideo(); // (picture in picture adds more; which one is the main picture can change)
    Volume.video = this.video; Volume.apply();
    this.layer.append(this.video, el("div", "vl-scrim"));
    $stage.insertBefore(this.layer, $pages);
    this.chip = el("div", "vchip"); $stage.append(this.chip);
  },
  modeFor(p) { return !this.active ? "off" : p instanceof LivePage ? "full" : this.bgMode; },
  place(p = top()) {
    const mode = this.modeFor(p);
    this.layer.classList.remove("off", "full", "behind", "corner");
    this.layer.classList.add(mode);
    this.updateChip(mode);
  },
  updateChip(mode = this.modeFor(top())) {
    const ch = this.ch;
    this.chip.classList.toggle("on", this.active && mode !== "full" && !!ch);
    if (ch) this.chip.innerHTML = `<b>live</b> ${esc(ch.number)} ${esc(ch.name)}${this.statusText ? ` · ${esc(this.statusText)}` : ""}`;
  },
  setStatus(t) { this.statusText = t; this.updateChip(); emitLive("status"); },
  async tune(guide, i) {
    BgVod.stop(); // live tv takes over from a movie playing behind the menus
    this.guide = guide; this.i = i;
    const gen = ++this.gen, ch = this.ch;
    if (ch) Prefs.set("lastChId", ch.id); // for settings → channels → start on last channel
    this.release();
    this.active = true;
    // tv takes over the sound: radio stops completely (a live station can't pick up where it left
    // off anyway), music just pauses
    if (Player.track && Player.track.live) Player.stop();
    else if (Player.playing) Player.toggle();
    this.place();
    this.setStatus(`tuning ${ch.number} ${ch.name}…`);
    emitLive("tune");
    let info;
    try { info = await Emby.liveStream(ch.id); }
    catch (e) { if (gen === this.gen) this.setStatus("couldn't tune this channel — " + lower(e.message)); return; }
    if (gen !== this.gen || !this.active) { Emby.stopStream(info); return; } // flipped or stopped meanwhile
    this.stream = info; this.light = false;
    this.hls = playStream(this.video, info);
  },
  release() {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.video.pause(); this.video.removeAttribute("src"); this.video.load();
    if (this.stream) { Emby.stopStream(this.stream); this.stream = null; }
  },
  stop() {
    if (!this.active) return;
    Dual.close();
    this.gen++; this.release(); this.active = false; this.statusText = "";
    this.place();
    const p = top(); if (p && p.el) applyBg(p);
    emitLive("stop");
  },
  togglePause() {
    if (!this.active) return false;
    const v = this.video;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    this.setStatus(v.paused ? "paused" : "");
    return true;
  },
};
function emitLive(evt) { const p = top(); if (p && p.el && p.live) p.live(evt); }

// Starts an Emby live stream in a <video>. Problems are reported to whichever picture the stream
// belongs to at that moment (the main one and the picture-in-picture one can trade places).
function playStream(v, info) {
  const report = (hls, text) => {
    if (hls && hls === Live.hls) return Live.setStatus(text);
    const p = Dual.smalls.find(x => x.hls === hls); if (p) Dual.status(p, text);
  };
  if (v.native) { // the Shield plays it itself
    v._onFail = msg => {
      const text = "the stream stopped" + (msg ? " — " + msg : "");
      if (v === Live.video) return Live.setStatus(text);
      const p = Dual.smalls.find(x => x.video === v); if (p) Dual.status(p, text);
    };
    v.src = info.url; v.play();
    return null;
  }
  if (window.Hls && Hls.isSupported()) {
    let recovered = false;
    const hls = new Hls({
      backBufferLength: 30, manifestLoadingTimeOut: 20000, manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 1000,
      levelLoadingMaxRetry: 6, fragLoadingMaxRetry: 6,
      xhrSetup: (xhr, url) => { const u = info.withKey(url); if (u !== url) xhr.open("GET", u, true); }, // keep sign-in on every request
    });
    hls.on(Hls.Events.ERROR, (e, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); }
      else report(hls, "the stream stopped — " + lower(String(d.details || "").replace(/([a-z])([A-Z])/g, "$1 $2")));
    });
    hls.loadSource(info.url);
    hls.attachMedia(v);
    v.play().catch(() => {});
    return hls;
  }
  if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = info.url; v.play().catch(() => {}); return null; }
  if (v === Live.video) Live.setStatus("this browser can't play live tv streams");
  else { const p = Dual.smalls.find(x => x.video === v); if (p) Dual.status(p, "this browser can't play live tv streams"); }
  return null;
}

/* ============ picture in picture: one big picture + up to three small ones ============
   The pip button in the player controls (or "add <channel>" by voice) shrinks the picture into the
   big spot on the left and opens the channel list; the pick plays in a small window on the right.
   - arrows move a white frame between the pictures; you hear the framed one
   - Enter: a small picture swaps into the big spot · the big one goes back to full screen alone
     · the empty "+ add" spot opens the channel list again
   - Back closes the framed picture (the others close up the gap); next / previous change its channel
   Kept smooth: every picture is a full-size video that is only ever moved and scaled (cheap for the
   graphics card), and moving a picture never restarts its stream.
   Every picture asks Emby for the same stream as normal tv. Asking for a smaller one for the little
   windows forced Emby to convert channels it otherwise just passes along (H.264 from Frndly / Philo),
   which made a third and fourth picture overload it; Edge shrinks the pictures itself instead. */
const PIP_LIGHT = false; // (the reduced-stream machinery stays, switched off)
// Two looks (settings → playback → picture in picture):
// "four": one big picture on the left (1440×810) + up to three small ones stacked on the right (480×270)
// "two":  the old Zune hub's side by side — the channel you were watching on the right half, the added one on the left
const SLOTS = {
  four: [
    { x: 0, y: 135, s: 0.75 },                                                                  // big
    { x: 1440, y: 135, s: 0.25 }, { x: 1440, y: 405, s: 0.25 }, { x: 1440, y: 675, s: 0.25 }, // small
  ],
  two: [{ x: 960, y: 270, s: 0.5 }, { x: 0, y: 270, s: 0.5 }],
};
const slotOf = k => (SLOTS[Dual.look] || SLOTS.four)[k];
const slotBox = k => { const s = slotOf(k); return { x: s.x, y: s.y, w: 1920 * s.s, h: 1080 * s.s }; };
// the big picture, read and written straight through to the live tv engine
const MAIN = {
  get i() { return Live.i; }, set i(v) { Live.i = v; },
  get video() { return Live.video; }, set video(v) { Live.video = v; Volume.video = v; Volume.apply(); },
  get hls() { return Live.hls; }, set hls(v) { Live.hls = v; },
  get stream() { return Live.stream; }, set stream(v) { Live.stream = v; },
  get light() { return !!Live.light; }, set light(v) { Live.light = v; },
  get status() { return Live.statusText; }, set status(v) { Live.statusText = v; },
  gen: 0, main: true,
};
function newVideo() {
  const v = NATIVE ? nativeVideo("lv-video", false) : el("video", "lv-video"); v.playsInline = true;
  v.addEventListener("playing", () => {
    if (v === Live.video) { Live.setStatus(""); emitLive("playing"); }
    const p = Dual.smalls.find(x => x.video === v); if (p) Dual.status(p, "");
  });
  v.addEventListener("waiting", () => {
    if (v === Live.video) Live.setStatus("buffering…");
    const p = Dual.smalls.find(x => x.video === v); if (p) Dual.status(p, "buffering…");
  });
  return v;
}
const Dual = {
  on: false, mode: null, smalls: [], f: 0, audio: 0, list: null, upTimer: null,
  pending: new Set(), // quality changes still waiting for their first picture
  dropPending() { this.pending.forEach(d => d()); this.pending.clear(); },
  get chans() { return (Live.guide && Live.guide.channels) || []; },
  pics() { return [MAIN, ...this.smalls]; },
  page() { const p = top(); return p instanceof LivePage && p.el ? p : null; },
  box() { const p = this.page(); return p ? p.q(".lv-dual") : null; },
  showing(i) { return this.pics().findIndex(p => p.i === i); },
  look: "four",
  get two() { return this.look === "two"; },
  get maxSmall() { return SLOTS[this.look].length - 1; },
  addSlot() { return this.smalls.length < this.maxSmall ? this.smalls.length + 1 : -1; }, // the "+ add" spot's number, or -1 when all are used

  // ----- arranging -----
  place(v, k, instant) {
    const s = slotOf(k), t = `translate(${s.x}px, ${s.y}px) scale(${s.s})`;
    if (instant) { v.style.transition = "none"; v.style.transform = t; void v.offsetWidth; v.style.transition = ""; }
    else v.style.transform = t;
  },
  layout() {
    if (!this.on) return;
    this.place(MAIN.video, 0);
    this.smalls.forEach((p, k) => this.place(p.video, k + 1));
    this.overlay();
  },
  // frame, labels and the "+ add" spot, drawn over the pictures (never scaled, so always crisp)
  overlay() {
    const box = this.box(); if (!box || !this.on) return;
    let ov = box.querySelector(".mv"); if (!ov) { ov = el("div", "mv", `<div class="mv-frame"></div>`); box.append(ov); }
    ov.querySelectorAll(".mv-tag, .mv-add").forEach(e => e.remove());
    this.pics().forEach((p, k) => {
      const b = slotBox(k), ch = this.chans[p.i];
      const tag = el("div", "mv-tag" + (slotOf(k).s < 0.4 ? " small" : ""), `${this.audio === k ? "♪ " : ""}<b>${esc(ch ? ch.number : "")}</b> ${esc(ch ? ch.name : "")}${p.status ? ` · ${esc(p.status)}` : ""}`);
      Object.assign(tag.style, { left: b.x + "px", top: b.y + b.h - (k ? 40 : 56) + "px", width: b.w + "px" });
      ov.append(tag);
    });
    const a = this.addSlot();
    if (a > 0 && this.mode !== "pick") {
      const b = slotBox(a), add = el("div", "mv-add sc", "+ add a channel");
      Object.assign(add.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
      ov.append(add);
    }
    const fr = ov.querySelector(".mv-frame"), fb = slotBox(Math.min(this.f, this.maxSmall));
    Object.assign(fr.style, { transform: `translate(${fb.x}px, ${fb.y}px)`, width: fb.w + "px", height: fb.h + "px" });
    fr.classList.toggle("on", this.mode === "play");
  },
  hint(text) {
    const box = this.box(); if (!box) return;
    let h = box.querySelector(".lv-dhint"); if (!h) { h = el("div", "lv-dhint sc"); box.append(h); }
    h.textContent = text;
    h.getAnimations().forEach(a => a.cancel());
    h.animate([{ opacity: 0 }, { opacity: 1, offset: .08 }, { opacity: 1, offset: .85 }, { opacity: 0 }], { duration: 6000, fill: "forwards" });
  },
  setAudio(k) {
    this.audio = clamp(k, 0, this.smalls.length);
    this.pics().forEach((p, j) => { p.video.muted = j !== this.audio; if (j) p.video.volume = MAIN.video.volume; });
    this.overlay();
  },
  status(p, text) { if (p === MAIN) Live.setStatus(text); else p.status = text; this.overlay(); },

  // ----- adding a channel -----
  // the picture shrinks into the big spot and the channel list opens over it
  pick(focus) {
    if (this.mode === "pick" || !Live.active || !this.page()) return false;
    if (this.chans.length < 2) { toast("there's only one channel"); return false; }
    if (this.addSlot() < 0) { toast(this.two ? "side by side shows two channels — pick a side with enter first" : "all four pictures are in use — close one with back first"); return false; }
    if (!this.on) {
      this.look = Prefs.get("pip") === "two" ? "two" : "four"; // the look is chosen when picture in picture starts
      this.on = true; this.f = 0; this.audio = 0;
      MAIN.video.muted = false;
      Live.layer.classList.add("multi");
      this.place(MAIN.video, 0);
    }
    this.mode = "pick";
    this.f = this.addSlot();
    const n = this.chans.length;
    let start = focus != null ? focus : (MAIN.i + 1) % n, guard = 0;
    while (focus == null && this.showing(start) >= 0 && guard++ < n) start = (start + 1) % n;
    this.renderPick(start);
    this.overlay();
    this.hint("↑ ↓ choose a channel · enter adds it · back cancels");
    return true;
  },
  renderPick(focus) {
    const box = this.box(); if (!box) return;
    const now = Date.now(), g = Live.guide;
    const row = (ch, i) => {
      const p = g && g.progs && g.progs.has(ch.id) ? g.progAt(ch, now) : null;
      const on = p && p.start <= now && p.end > now ? p.title : "";
      const shown = this.showing(i) >= 0;
      return el("div", "r-dual" + (shown ? " main" : ""),
        `<span class="n">${esc(ch.number)}</span><div class="tx"><div class="t1 caps">${esc(ch.name)}</div><div class="t2 sc">${shown ? "already showing" : esc(on)}</div></div>`);
    };
    this.list = List({ items: this.chans, itemH: 96, height: 672, row, focus });
    const pickEl = el("div", "lv-pick");
    pickEl.append(el("div", "lv-pick-h sc", "add a channel"), this.list.el);
    box.querySelector(".lv-pick")?.remove();
    box.append(pickEl);
    slideIn([pickEl], -1, { dist: 120, dur: 420 });
  },
  closePick() {
    const pickEl = this.box()?.querySelector(".lv-pick");
    if (pickEl) slideOut([pickEl], -1, { dist: 120, dur: 240 }).then(() => pickEl.remove());
  },
  choose(i) {
    if (this.showing(i) >= 0) { toast("that channel is already showing"); return false; }
    const k = this.addSlot(); if (k < 0) return false;
    this.closePick();
    this.mode = "play";
    const p = { i, video: newVideo(), hls: null, stream: null, light: PIP_LIGHT && !this.two, status: "", gen: 0 };
    p.video.muted = true;
    p.video.style.opacity = 0; // fades in once its picture actually arrives
    this.place(p.video, k, true);
    Live.layer.insertBefore(p.video, Live.layer.querySelector(".vl-scrim"));
    this.smalls.push(p);
    this.f = 0;
    this.layout();
    this.open(p, PIP_LIGHT && !this.two);
    this.hint(this.two ? "← → choose the sound · enter or back keeps that side full screen"
      : "arrows pick a picture (you hear the framed one) · enter swaps it into the big spot · back closes it");
    return true;
  },
  // start (or restart) a small picture's channel
  async open(p, light) {
    const gen = ++p.gen, ch = this.chans[p.i];
    if (p.hls) { p.hls.destroy(); p.hls = null; }
    if (p.stream) { Emby.stopStream(p.stream); p.stream = null; }
    this.status(p, `tuning ${ch.number} ${ch.name}…`);
    let info;
    try { info = await Emby.liveStream(ch.id, { light }); }
    catch (e) { if (gen === p.gen) this.status(p, /tuner/i.test(e.message) ? "no free tuner" : "couldn't tune — " + lower(e.message)); return; }
    if (gen !== p.gen || !this.smalls.includes(p)) { Emby.stopStream(info); return; }
    p.stream = info; p.light = light;
    p.hls = playStream(p.video, info);
    p.video.addEventListener("playing", () => { p.video.style.opacity = 1; }, { once: true });
  },
  // quietly change a picture's stream quality (full for the big spot, light for small ones): the new
  // stream plays in a hidden copy at the same place and takes over the moment it has a picture
  async requality(p, light) {
    if (p.light === light || !Live.active) return;
    const gen = ++p.gen, ch = this.chans[p.i];
    if (!ch) return;
    let info;
    try { info = await Emby.liveStream(ch.id, { light }); } catch { return; }
    const still = () => gen === p.gen && Live.active && (p === MAIN || this.smalls.includes(p));
    if (!still()) { Emby.stopStream(info); return; }
    const v = newVideo(), oldV = p.video;
    v.muted = oldV.muted; v.volume = oldV.volume; v.style.opacity = 0; v.style.transform = oldV.style.transform;
    Live.layer.insertBefore(v, oldV.nextSibling);
    const hls = playStream(v, info);
    let settled = false;
    const drop = () => { if (settled) return; settled = true; if (hls) hls.destroy(); Emby.stopStream(info); v.pause(); v.remove(); };
    this.pending.add(drop);
    setTimeout(() => { drop(); this.pending.delete(drop); }, 20000); // never got going: forget it, the old stream carries on
    v.addEventListener("playing", () => {
      this.pending.delete(drop);
      if (settled) return;
      if (!still() || p.video !== oldV) return drop();
      settled = true;
      // take the picture's place as it is NOW (it may have moved, e.g. back to full screen, since this copy started)
      v.style.transition = "none"; v.style.transform = oldV.style.transform; void v.offsetWidth;
      v.style.transition = ""; v.style.opacity = 1; // (normal motion from here, so a move during the hand-over still glides)
      const old = { hls: p.hls, stream: p.stream };
      p.video = v; p.hls = hls; p.stream = info; p.light = light;
      setTimeout(() => { v.style.transition = ""; if (old.hls) old.hls.destroy(); if (old.stream) Emby.stopStream(old.stream); oldV.pause(); oldV.remove(); }, 450);
    }, { once: true });
  },

  // ----- changing places -----
  // a small picture and the big one trade places — both keep playing, nothing restarts
  swap(k) {
    const p = this.smalls[k - 1]; if (!p) return;
    const m = { i: MAIN.i, video: MAIN.video, hls: MAIN.hls, stream: MAIN.stream, light: MAIN.light, status: MAIN.status };
    MAIN.i = p.i; MAIN.video = p.video; MAIN.hls = p.hls; MAIN.stream = p.stream; MAIN.light = p.light; MAIN.status = p.status;
    Object.assign(p, m); p.gen++;
    MAIN.gen++; Live.gen++;
    const pg = this.page(); if (pg) pg.i = MAIN.i;
    if (this.audio === k) this.audio = 0; else if (this.audio === 0) this.audio = k;
    this.f = 0;
    this.layout(); this.setAudio(this.audio);
    Live.updateChip();
    // after it settles: the big one gets full quality, the one now small a light stream
    clearTimeout(this.upTimer);
    this.upTimer = setTimeout(() => { if (!this.on) return; this.requality(MAIN, false); this.smalls.forEach(s => this.requality(s, PIP_LIGHT && !this.two)); }, 1500);
  },
  // close one picture; closing the big one moves the first small one up into its place
  remove(k) {
    if (k === 0) {
      if (!this.smalls.length) return this.exit();
      this.swap(1);
      k = 1;
    }
    const p = this.smalls[k - 1]; if (!p) return;
    p.gen++;
    this.smalls.splice(k - 1, 1);
    p.video.style.opacity = 0;
    setTimeout(() => { if (p.hls) p.hls.destroy(); if (p.stream) Emby.stopStream(p.stream); p.video.pause(); p.video.remove(); }, 450);
    if (!this.smalls.length) return this.exit();
    this.f = Math.min(this.f, this.smalls.length);
    this.setAudio(this.audio === k ? 0 : this.audio > k ? this.audio - 1 : this.audio);
    this.layout();
  },
  // back to one picture: the big one (or the one numbered keep) fills the screen again
  exit(keep = 0) {
    if (!this.on || this.mode === "leaving") return;
    if (keep > 0) this.swap(keep);
    this.mode = "leaving";
    this.closePick();
    for (const p of this.smalls) {
      p.gen++; p.video.style.opacity = 0;
      setTimeout(() => { if (p.hls) p.hls.destroy(); if (p.stream) Emby.stopStream(p.stream); p.video.pause(); p.video.remove(); }, 450);
    }
    this.smalls = [];
    MAIN.video.muted = false;
    MAIN.video.style.transform = ""; // glides back to full screen
    Live.layer.classList.remove("multi");
    this.box()?.querySelector(".mv")?.remove();
    setTimeout(() => this.finish(), 460);
    if (MAIN.light) setTimeout(() => this.requality(MAIN, false), 700); // full quality again
  },
  finish(quiet) {
    clearTimeout(this.upTimer);
    if (!Live.active) this.dropPending();
    this.on = false; this.mode = null; this.list = null; this.f = 0; this.audio = 0;
    const box = this.box(); if (box) box.innerHTML = "";
    const p = this.page(); if (p && !quiet) { p.fill(); p.banner(); }
    Live.updateChip();
  },
  // straight away, no animation (tv stopped, or the player screen left): keep the big one
  close() {
    this.dropPending();
    if (!this.on) { if (MAIN.light && Live.active) setTimeout(() => this.requality(MAIN, false), 300); return; }
    for (const p of this.smalls) { p.gen++; if (p.hls) p.hls.destroy(); if (p.stream) Emby.stopStream(p.stream); p.video.pause(); p.video.remove(); }
    this.smalls = [];
    const v = MAIN.video;
    v.muted = false; v.style.transition = "none"; v.style.transform = ""; void v.offsetWidth; v.style.transition = "";
    Live.layer.classList.remove("multi");
    this.finish(true);
    if (MAIN.light && Live.active) setTimeout(() => this.requality(MAIN, false), 300);
  },

  // ----- keys -----
  move(k) {
    const n = this.pics().length, add = this.addSlot();
    const last = add > 0 ? add : n - 1;
    if (k === "left") this.f = 0;
    else if (k === "right") this.f = this.f === 0 ? 1 : this.f;
    else if (k === "up") this.f = this.f > 1 ? this.f - 1 : this.f;
    else if (k === "down") this.f = this.f >= 1 && this.f < last ? this.f + 1 : this.f;
    if (this.f > last) this.f = last;
    if (this.f < n) this.setAudio(this.f); else this.overlay(); // the "+ add" spot has no sound of its own
  },
  key(k) {
    if (this.mode === "pick") {
      if (k === "up" || k === "down") this.list.move(k === "up" ? -1 : 1);
      else if (k === "ok") this.choose(this.list.index);
      else if (k === "back") { this.closePick(); if (!this.smalls.length) this.exit(); else { this.mode = "play"; this.f = 0; this.overlay(); } }
      return true;
    }
    if (this.mode !== "play") return true; // mid-animation
    if (this.two) { // the old Zune hub's way: ← → pick the side you hear, Enter or Back keeps that side full screen
      if (k === "left" || k === "right") { this.f = k === "left" ? 1 : 0; this.setAudio(this.f); }
      else if (k === "ok" || k === "back") this.exit(this.f);
      return true;
    }
    if (["left", "right", "up", "down"].includes(k)) { this.move(k); return true; }
    const n = this.pics().length;
    if (k === "ok") {
      if (this.f >= n) this.pick();          // the "+ add" spot
      else if (this.f === 0) this.exit();    // the big one alone, full screen
      else this.swap(this.f);                // a small one into the big spot
      return true;
    }
    if (k === "back") { if (this.f < n) this.remove(this.f); else { this.f = 0; this.overlay(); } return true; }
    return true;
  },
  // next / previous: change the channel of the framed picture
  mediaKey(k, page) {
    if (k === "stop") return false;
    if (this.mode !== "play") return true;
    const n = this.chans.length, d = k === "next" ? 1 : -1, pics = this.pics();
    const p = pics[Math.min(this.f, pics.length - 1)];
    let j = (p.i + d + n) % n, guard = 0;
    while (this.showing(j) >= 0 && guard++ < n) j = (j + d + n) % n;
    if (p === MAIN) { page.i = j; page.chnum(this.chans[j].number); Live.light = false; Live.tune(Live.guide, j); }
    else { p.i = j; p.video.style.opacity = 0; this.open(p, PIP_LIGHT && !this.two); }
    this.overlay();
    return true;
  },
};
// (voice) find a channel by number or name in the channel list the tv is using
function dualChannelIndex(q) {
  const chans = (Live.guide && Live.guide.channels) || [];
  const ch = chans.find(c => c.number && norm(c.number) === norm(q)) || bestMatch(chans, q, c => c.name);
  return ch ? chans.indexOf(ch) : -1;
}

/* ============ closed captions on live tv ============
   TV channels carry captions inside the video (the standard 608 kind; tested on OTA, Frndly and Philo
   through Emby). The video player reads them into a caption track; this shows them in the app's own
   style, low on the picture, stepping up above the player controls while those are showing. They follow
   the picture you're hearing (picture in picture), and the on / off choice is remembered. */
const CC = {
  get on() { return !!Prefs.get("cc"); },
  set(on) {
    Prefs.set("cc", !!on); this.render();
    const p = top(); if (p instanceof LivePage && p.el && p.mode !== "hidden") p.fill();
  },
  video: null, track: null,
  source() { // the picture whose captions to show
    if (!Live.active) return null;
    if (Dual.on) { const p = Dual.pics()[Dual.audio]; return p ? p.video : null; }
    return Live.video;
  },
  tick() {
    const v = this.source();
    if (v !== this.video) { if (this.track) this.track.oncuechange = null; this.video = v; this.track = null; }
    if (v && !this.track) {
      const tracks = [...v.textTracks].filter(t => t.kind === "captions" || t.kind === "subtitles");
      const t = tracks.find(t => /cc1|english|\ben\b/i.test(`${t.label} ${t.language}`)) || tracks[0];
      if (t) { this.track = t; t.oncuechange = () => this.render(); }
    }
    // read the captions ourselves; the browser's own drawing stays off
    if (v) [...v.textTracks].forEach(t => { if (t.mode !== "hidden") t.mode = "hidden"; });
    this.render();
  },
  render() {
    const p = top(), box = p instanceof LivePage && !(p instanceof VodPage) && !(p instanceof YtPage) && p.el ? p.q(".lv-cc") : null;
    if (!box) return;
    const cues = this.on && this.track && this.track.activeCues ? [...this.track.activeCues] : [];
    // each caption line arrives as its own piece with its screen row, not always in reading order:
    // put them top to bottom (then by when they appeared), so "hello / neighbor" doesn't come out upside down
    const row = c => typeof c.line === "number" ? c.line : 1e6;
    cues.forEach((c, i) => { c._order = i; });
    cues.sort((a, b) => row(a) - row(b) || a.startTime - b.startTime || a._order - b._order);
    const text = cues.map(c => String(c.text || "").replace(/<[^>]+>/g, "")).join("\n").trim();
    if (box.dataset.text !== text) {
      box.dataset.text = text;
      box.innerHTML = text ? text.split("\n").filter(l => l.trim()).map(l => `<span>${esc(l.trim())}</span>`).join("<br>") : "";
    }
    box.classList.toggle("on", !!text);
    if (Dual.on) { // picture in picture: under the picture you're hearing
      const k = Math.min(Dual.audio, Dual.maxSmall), b = slotBox(k), small = slotOf(k).s < 0.4;
      Object.assign(box.style, { left: b.x + "px", width: b.w + "px", bottom: (1080 - b.y - b.h + (small ? 44 : 70)) + "px" });
      box.classList.toggle("small", small);
    } else if (box.style.left) {
      box.style.left = box.style.width = box.style.bottom = ""; box.classList.remove("small");
    }
  },
};
setInterval(() => { const p = top(); if (p instanceof LivePage && !(p instanceof VodPage) && !(p instanceof YtPage)) CC.tick(); }, 400);

/* ============ watching live tv (full screen) ============
   Player controls work like Kodi's on-screen display, in the Zune style:
   - Enter shows the controls (play/pause is picked first); ←/→ moves between buttons, Enter presses one.
   - The controls hide after a few seconds without a key press (settings → playback).
   - Back closes the controls first; with nothing showing, Back returns to the menus (tv keeps playing behind).
   - With the controls hidden, ←/→ skip back / ahead 30 seconds (as far as the server has buffered).
   - ↑/↓ are deliberately left free. The remote's next/previous keys change channel, stop stops.
   When a channel starts, a short info banner (no buttons) shows on its own (settings → live tv info hides after). */
const PLAYER_BUTTONS = [
  ["chdown", "ch −", `<svg viewBox="0 0 24 24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>`],
  ["rw", "back 30s", `<svg viewBox="0 0 24 24"><path d="M11 12 19 6v12zm-8 0 8-6v12z"/></svg>`],
  ["play", "pause", ""], // icon and label follow the play state
  ["ff", "fwd 30s", `<svg viewBox="0 0 24 24"><path d="M5 6l8 6-8 6zm8 0 8 6-8 6z"/></svg>`],
  ["chup", "ch +", `<svg viewBox="0 0 24 24"><path d="M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg>`],
  ["stop", "stop", `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>`],
  ["rec", "record", `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>`], // record the show that's on (Emby's DVR)
  ["info", "info", `<svg viewBox="0 0 24 24"><path d="M11 10h2v7h-2zm0-3h2v2h-2z"/></svg>`],
  ["cc", "captions", `<svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zm2 2v10h14V7zm2.5 2.5h3v1.3h-1.7v2.4h1.7v1.3h-3zm5 0h3v1.3h-1.7v2.4h1.7v1.3h-3z"/></svg>`], // closed captions on / off
  ["dual", "pip", `<svg viewBox="0 0 24 24"><path d="M2 6h9v12H2zm11 0h9v12h-9zM4 8v8h5V8z"/></svg>`], // picture in picture
];
const PLAY_BTN = PLAYER_BUTTONS.findIndex(b => b[0] === "play");

class LivePage extends Page {
  constructor(guide, i) { super(); this.guide = guide; this.i = Math.max(0, i); this.mode = "hidden"; this.bi = PLAY_BTN; this.hideGen = 0; }
  get ch() { return this.guide.channels[this.i]; }
  bg() { return { opacity: 0 }; }
  render() {
    const r = el("div", "live-page");
    r.innerHTML = `<div class="lv-status"></div><div class="lv-dual"></div><div class="lv-cc"></div>
      <div class="lv-glyph"></div><div class="lv-chnum"></div>
      <div class="lv-peek"><div class="lv-peek-txt sc"></div><div class="lv-bar"><i></i></div></div>
      <div class="lv-osd">
        <div class="lv-ch"></div><div class="lv-title"></div><div class="lv-sub sc"></div>
        <div class="lv-ov"><div></div></div>
        <div class="lv-times sc"><span class="a"></span><span class="b"></span></div>
        <div class="lv-bar"><i></i></div>
        <div class="lv-ctl"><div class="lv-hl"></div></div>
      </div>`;
    this.btnEls = this.buttons().map(([id, label, icon]) => {
      // the skip buttons say how far they jump (settings → playback → skip back / skip ahead)
      if (id === "rw") label = `back ${-skipBy(-1)}s`;
      if (id === "ff") label = `fwd ${skipBy(1)}s`;
      const b = el("div", "rb", `<span class="ring">${icon}</span><span class="lbl">${esc(label)}</span>`);
      b.dataset.id = id;
      r.querySelector(".lv-ctl").append(b);
      return b;
    });
    return r;
  }
  buttons() { return PLAYER_BUTTONS; }
  q(s) { return this.el.querySelector(s); }
  mounted() {
    if (Live.isOn(this.ch)) { // already playing this channel: just bring it full screen, no re-tune
      Live.guide = this.guide; Live.i = this.i;
      this.status(Live.statusText); this.banner();
      if (Live.video.paused) this.pauseGlyph(true);
    } else Live.tune(this.guide, this.i);
  }
  unmount() { Dual.close(); clearTimeout(this.osdTimer); clearTimeout(this.peekTimer); clearInterval(this.tickTimer); super.unmount(); }
  enter() { return done(this.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: "ease-out" })); }
  leave() {
    // the picture keeps playing; put the guide's highlight on the channel we were watching
    const g = this.guide; g.ci = this.i;
    if (g.ci < g.top) g.top = g.ci;
    if (g.ci >= g.top + G.rows) g.top = g.ci - G.rows + 1;
    g.ft = Date.now(); g.showTime(g.ft); g.ensurePrograms();
    return done(this.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }));
  }
  status(text) { if (this.el) this.q(".lv-status").textContent = text; }
  live(evt) {
    if (evt === "stop") { if (top() === this) back(); return; } // tv stopped (stop button, voice, youtube…): leave the empty screen
    if (evt === "status") { this.status(Dual.on ? "" : Live.statusText); if (!this.swapping) this.fill(); }
    if (Dual.on) { Dual.overlay(); return; } // several pictures: no banner over them
    if (this.swapping) return; // a channel change is mid-slide; it fills in the new info itself
    // The channel banner shows once, when you pick the channel. When the picture actually starts
    // (after buffering) it isn't shown again; if it's still up, its countdown restarts so you get
    // the full time with the picture visible. Later buffering hiccups don't bring it back either.
    if (evt === "tune") this.mode === "controls" ? this.fill() : this.banner();
    if (evt === "playing") {
      if (this.mode === "banner") { this.fill(); this.arm("liveHide"); }
      else if (this.mode === "controls") this.fill();
    }
  }

  // ----- what's on (fills the info lines and the time bars) -----
  current() {
    const ch = this.ch, now = Date.now();
    if (!this.guide.progs.has(ch.id) && Emby.connected) {
      this.guide.progs.set(ch.id, []);
      Emby.programs([ch.id], now - 4 * HOUR, now + 8 * HOUR).then(list => {
        this.guide.progs.set(ch.id, list.sort((a, b) => a.start - b.start));
        if (this.el && this.ch === ch) this.fill();
      }).catch(() => {});
    }
    const p = this.guide.progs.has(ch.id) ? this.guide.progAt(ch, now) : null;
    return p && p.start <= now && p.end > now ? p : null;
  }
  // seconds behind the live edge (after skipping back), or 0
  behind() {
    const v = Live.video, r = v.seekable;
    if (!r || !r.length) return 0;
    const gap = r.end(r.length - 1) - v.currentTime;
    return gap > 8 ? gap : 0;
  }
  fill() {
    if (!this.el) return;
    const ch = this.ch, p = this.current(), now = Date.now(), lag = this.behind();
    this.q(".lv-ch").textContent = `${ch.number}  ${ch.name}`;
    this.q(".lv-title").textContent = p ? progTitle(p) : ch.name;
    const where = lag ? `${fmt(lag)} behind live` : "live";
    this.q(".lv-sub").innerHTML = [p && p.timerId ? `<b class="recdot">● rec</b>` : "", ...[p && p.ep, where, Live.video.paused && Live.active ? "paused" : ""].filter(Boolean).map(esc)].filter(Boolean).join(" · ");
    const rec = this.btnEls.find(b => b.dataset.id === "rec");
    if (rec) { rec.querySelector(".lbl").textContent = p && p.timerId ? "recording" : "record"; rec.classList.toggle("recording", !!(p && p.timerId)); }
    this.q(".lv-ov div").textContent = (p && p.overview) || "no description.";
    this.q(".lv-times .a").textContent = p ? clock12(p.start) : "";
    this.q(".lv-times .b").textContent = p ? clock12(p.end) : "";
    const pct = p ? Math.min(100, (now - lag * 1000 - p.start) / (p.end - p.start) * 100) + "%" : "0";
    qa(this.el, ".lv-bar i").forEach(i => { i.style.width = pct; });
    qa(this.el, ".lv-bar").forEach(b => { b.style.visibility = p ? "" : "hidden"; });
    this.q(".lv-peek-txt").textContent = where;
    const paused = Live.video.paused && Live.active, play = this.btnEls[PLAY_BTN];
    play.querySelector(".ring").innerHTML = paused ? ICON.play : ICON.pause;
    play.querySelector(".lbl").textContent = paused ? "play" : "pause";
    const cc = this.btnEls.find(b => b.dataset.id === "cc");
    if (cc) { cc.querySelector(".lbl").textContent = CC.on ? "cc on" : "cc off"; cc.classList.toggle("lit", CC.on); }
  }

  // ----- showing / hiding (with the Zune-style motion) -----
  textEls() { return [".lv-ch", ".lv-title", ".lv-sub", ".lv-times", ".lv-osd .lv-bar"].map(s => this.q(s)); }
  setMode(mode) {
    const prev = this.mode, osd = this.q(".lv-osd");
    this.mode = mode;
    this.el.classList.toggle("osdup", mode !== "hidden"); // captions step up above the controls
    clearInterval(this.tickTimer);
    if (mode === "hidden") { if (prev !== "hidden") this.animateOut(); return; }
    this.hideGen++; // cancel a hide that's still running
    qa(osd, "*").forEach(e => e.getAnimations().forEach(a => a.id === "osd-out" && a.cancel()));
    osd.classList.add("on");
    osd.classList.toggle("ctl", mode === "controls");
    if (mode !== "controls") osd.classList.remove("info");
    this.fill();
    this.tickTimer = setInterval(() => this.fill(), 1000);
    this.btnEls.forEach((b, i) => b.classList.toggle("focus", mode === "controls" && i === this.bi));
    if (prev === "hidden") this.animateIn();
    if (mode === "controls" && prev !== "controls") this.animateButtons();
  }
  // 1 + 3: the lines cascade in from the right, then the time bar draws itself from the left
  animateIn() {
    slideIn(this.textEls(), 1, { dist: 150, dur: 560, stagger: 45 });
    this.q(".lv-osd .lv-bar").animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
      { id: "osd", duration: 700, delay: 180, easing: EASE, fill: "backwards" });
  }
  // 2: the round buttons zoom up one after another, left to right (the highlight disc arrives with its button)
  animateButtons() {
    this.placeHighlight(true);
    const zoom = (e, i) => e.animate([{ opacity: 0, transform: "scale(.55)" }, { opacity: 1, transform: "scale(1)" }],
      { id: "osd", duration: 420, delay: 60 + i * 38, easing: EASE, fill: "backwards" });
    this.btnEls.forEach((b, i) => zoom(b.querySelector(".ring"), i));
    this.btnEls.forEach((b, i) => b.querySelector(".lbl").animate([{ opacity: 0 }, { opacity: 1 }], { id: "osd", duration: 300, delay: 160 + i * 38, fill: "backwards" }));
    const hl = this.q(".lv-hl");
    hl.animate([{ opacity: 0, scale: ".55" }, { opacity: 1, scale: "1" }], { id: "osd", duration: 420, delay: 60 + this.bi * 38, easing: EASE, fill: "backwards" });
  }
  // 4: hiding runs it backward and faster — buttons drop away right to left, then the text slides off left
  animateOut() {
    const gen = ++this.hideGen, osd = this.q(".lv-osd"), had = osd.classList.contains("ctl");
    const out = (e, delay, frames, dur = 170) => e.animate(frames, { id: "osd-out", duration: dur, delay, easing: EASE_IN, fill: "forwards" });
    let t = 0;
    if (had) {
      [...this.btnEls].reverse().forEach((b, i) => out(b, i * 22, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.7)" }]));
      out(this.q(".lv-hl"), (this.btnEls.length - 1 - this.bi) * 22, [{ opacity: 1 }, { opacity: 0 }]);
      t = 120;
    }
    [this.q(".lv-ov"), ...this.textEls()].forEach((e, i) => out(e, t + i * 22, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-110px)" }], 190));
    setTimeout(() => {
      if (!this.el || gen !== this.hideGen) return; // shown again meanwhile
      // The lines stay faded out (their "osd-out" fades are only cleared the next time the panel shows);
      // resetting them here made them flash back while the dark backdrop was still fading.
      osd.classList.remove("on", "ctl", "info");
    }, t + 330);
  }
  // 5: one white disc glides from button to button
  placeHighlight(instant) {
    const hl = this.q(".lv-hl"), ring = this.btnEls[this.bi].querySelector(".ring");
    if (instant) { hl.style.transition = "none"; void hl.offsetWidth; }
    hl.style.transform = `translateX(${ring.offsetLeft}px)`;
    if (instant) { void hl.offsetWidth; hl.style.transition = ""; }
  }
  focusBtn(d) {
    const n = clamp(this.bi + d, 0, this.btnEls.length - 1);
    if (n === this.bi) return;
    this.bi = n;
    this.btnEls.forEach((b, i) => b.classList.toggle("focus", i === this.bi));
    this.placeHighlight(false);
  }
  arm(prefKey) { // restart the "hide after a few seconds" countdown
    clearTimeout(this.osdTimer);
    const secs = Prefs.get(prefKey);
    if (secs > 0) this.osdTimer = setTimeout(() => this.el && this.setMode("hidden"), secs * 1000);
  }
  infoOpen() { return !!this.el && this.mode === "controls" && this.q(".lv-osd").classList.contains("info"); }
  banner() { if (this.mode === "controls") return; this.setMode("banner"); this.arm("liveHide"); }
  controls() { this.setMode("controls"); this.arm("osdHide"); }

  // ----- 7: big faint glyphs in the middle of the picture -----
  glyph(html) {
    const g = this.q(".lv-glyph");
    g.getAnimations().forEach(a => a.cancel());
    g.innerHTML = html;
    g.animate([
      { opacity: 0, transform: "scale(.6)" }, { opacity: .85, transform: "scale(1)", offset: .25 },
      { opacity: .85, transform: "scale(1)", offset: .6 }, { opacity: 0, transform: "scale(1.15)" },
    ], { duration: 1100, easing: "ease-out", fill: "forwards" });
    this.paused = false;
  }
  // a big ❚❚ settles in the middle while paused, and zooms away when it plays again
  pauseGlyph(paused) {
    const g = this.q(".lv-glyph");
    g.getAnimations().forEach(a => a.cancel());
    if (paused) {
      g.innerHTML = ICON.pause;
      g.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: .5, transform: "scale(1)" }], { duration: 450, easing: EASE, fill: "forwards" });
    } else if (this.paused) {
      g.innerHTML = ICON.pause;
      g.animate([{ opacity: .5, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.45)" }], { duration: 380, easing: EASE_IN, fill: "forwards" });
    }
    this.paused = paused;
  }
  // a thin time bar peeks up from the bottom after a skip (when the controls are hidden), then slides away
  peek() {
    if (this.mode !== "hidden") return;
    const p = this.q(".lv-peek");
    this.fill();
    p.classList.add("on");
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => this.el && p.classList.remove("on"), 1800);
  }

  // ----- 8: channel changes slide, and the new number shows big for a moment -----
  async changeChannel(d) {
    const n = this.guide.channels.length;
    this.i = (this.i + d + n) % n;
    this.chnum(this.ch.number);
    if (this.mode === "hidden") { Live.tune(this.guide, this.i); return; } // its banner cascades in on its own
    this.swapping = true;
    const els = [...this.textEls(), this.q(".lv-ov")];
    Live.tune(this.guide, this.i);
    await Promise.race([slideOut(els, d, { dist: 140, dur: 180, stagger: 20 }), wait(320)]);
    this.swapping = false;
    if (!this.el) return;
    this.fill();
    slideIn(els, d, { dist: 200, dur: 520, stagger: 40 });
  }
  chnum(text) {
    const c = this.q(".lv-chnum");
    c.getAnimations().forEach(a => a.cancel());
    c.textContent = text;
    c.animate([
      { opacity: 0, transform: "scale(.8)" }, { opacity: .32, transform: "scale(1)", offset: .2 },
      { opacity: .32, transform: "scale(1)", offset: .7 }, { opacity: 0, transform: "scale(1)" },
    ], { duration: 1900, easing: "ease-out", fill: "forwards" });
  }

  // ----- actions -----
  press(id) {
    if (id === "play") { Live.togglePause(); this.pauseGlyph(Live.video.paused); }
    else if (id === "rw" || id === "ff") this.skip(id === "ff" ? 1 : -1);
    else if (id === "chup" || id === "chdown") return this.changeChannel(id === "chup" ? 1 : -1);
    else if (id === "stop") { Live.stop(); return; } // the "stop" event takes us back to the menus
    else if (id === "info") { // 6: unfolds smoothly (styles.css). While it's open it stays until Back.
      const open = this.q(".lv-osd").classList.toggle("info");
      if (open) clearTimeout(this.osdTimer); else this.arm("osdHide");
    }
    else if (id === "dual") { this.setMode("hidden"); Dual.pick(); return; }
    else if (id === "cc") { CC.set(!CC.on); toast(CC.on ? "captions on" : "captions off"); }
    else if (id === "rec") {
      const p = this.current();
      if (!p) toast("there's no guide information for this show, so it can't be recorded from here");
      else if (!Emby.connected) toast("sign in to emby to record");
      else DVR.toggle(p).then(() => this.el && this.fill());
    }
    this.fill();
  }
  // skip back / ahead within what the server has buffered (settings → playback → skip back / skip ahead);
  // past "now" snaps back to live
  skip(dir) {
    const v = Live.video, r = v.seekable;
    if (!r || !r.length || r.end(r.length - 1) - r.start(0) < 5) { toast("can't skip on this channel"); return; }
    const start = r.start(0), end = r.end(r.length - 1), by = skipBy(dir);
    let t = v.currentTime + by;
    if (t >= end - 4) { t = end - 1; this.glyph("live"); }
    else if (t < start) { t = start; this.glyph("start"); }
    else this.glyph(by < 0 ? `−${-by}` : `+${by}`);
    v.currentTime = t;
    this.peek();
  }
  playKey() {
    const r = Live.togglePause();
    this.pauseGlyph(Live.video.paused);
    this.fill();
    return r;
  }
  // the remote's next / previous / stop keys
  mediaKey(k) {
    if (k === "stop") { this.press("stop"); return true; }
    if (Dual.on) return Dual.mediaKey(k, this);
    if (k === "next" || k === "prev") { this.changeChannel(k === "next" ? 1 : -1); return true; }
    return false;
  }
  key(k) {
    if (Dual.on) return Dual.key(k); // picture in picture has its own keys
    if (k === "back") {
      if (this.infoOpen()) { this.q(".lv-osd").classList.remove("info"); this.arm("osdHide"); return true; } // Back folds the info away
      if (this.mode === "controls") { this.setMode("hidden"); return true; } // first Back just closes the controls
      this.setMode("hidden");
      return false; // otherwise back to the menus (an info banner doesn't hold you up); the tv keeps playing behind them
    }
    if (this.mode === "controls") {
      if (k === "left" || k === "right") this.focusBtn(k === "left" ? -1 : 1);
      else if (k === "ok") this.press(this.btnEls[this.bi].dataset.id);
      if (this.mode === "controls" && !this.infoOpen()) this.arm("osdHide"); // any key keeps them up a little longer
      return true;
    }
    if (k === "ok") { this.bi = PLAY_BTN; this.controls(); return true; }
    if (k === "left" || k === "right") { this.skip(k === "right" ? 1 : -1); return true; }
    return true; // ↑/↓ left free on purpose
  }
}

/* ============ watching a movie or episode ============
   The same Zune-style controls as live tv (Enter shows them, ← → pick, they hide on their own;
   info stays open until Back). With the controls hidden, ← / → jump back 10 / ahead 30 seconds.
   Emby is told where you are every few seconds, so "resume" and "continue watching" stay right.
   Back (with nothing showing) stops and returns to the movie's page. */
const VOD_BUTTONS = [
  ["start", "from start", `<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zm3 7 9-7v14z"/></svg>`],
  ["rw", "back 10s", PLAYER_BUTTONS.find(b => b[0] === "rw")[2]],
  ["play", "pause", ""],
  ["ff", "fwd 30s", PLAYER_BUTTONS.find(b => b[0] === "ff")[2]],
  ["stop", "stop", PLAYER_BUTTONS.find(b => b[0] === "stop")[2]],
  ["info", "info", PLAYER_BUTTONS.find(b => b[0] === "info")[2]],
];
const VOD_PLAY = VOD_BUTTONS.findIndex(b => b[0] === "play");

class VodPage extends LivePage {
  constructor(v, from = 0) { super({ channels: [] }, 0); this.v = v; this.from = from; this.bi = VOD_PLAY; }
  get ch() { return null; }
  get titleKey() { return null; }
  buttons() { return VOD_BUTTONS; }
  render() {
    const r = super.render();
    r.classList.add("vod-page");
    // back from the menus: this movie kept playing behind them (BgVod), so its own video comes back
    const kept = BgVod.give(this);
    this.resumed = !!kept;
    this.video = kept || (NATIVE ? nativeVideo("vod-video", true) : el("video", "vod-video")); this.video.playsInline = true;
    r.prepend(this.video);
    return r;
  }
  async mounted() {
    if (this.resumed) { // already playing: just full screen again
      Live.stop();
      if (Player.playing) Player.toggle();
      Volume.apply();
      this.status(""); this.banner();
      if (this.video.paused) this.pauseGlyph(true);
      return;
    }
    BgVod.stop(); // another movie or show was playing behind the menus
    Live.stop();
    if (Player.playing) Player.toggle(); // music pauses while a movie plays
    const v = this.video;
    Volume.apply();
    v.addEventListener("playing", () => { this.status(""); if (this.el && this.mode !== "hidden") this.fill(); if (!this.el) BgVod.place(); });
    v.addEventListener("waiting", () => { if (!this.fixing) this.status("buffering…"); });
    v.addEventListener("pause", () => { if (!this.el) BgVod.place(); });
    v.addEventListener("ended", () => { // ended long before the movie's real length = the stream broke, not the end
      const real = (this.info && this.info.dur) || this.v.runtime || 0;
      if (real > 120 && v.currentTime < real - 60) this.trouble(); else this.finished();
    });
    v.addEventListener("error", () => this.trouble()); // Edge couldn't decode it: carry on with Emby converting
    this.startGen = 0;
    this.start(this.from, false);
    this.banner();
  }
  async start(from, convert) {
    const v = this.video, gen = ++this.startGen;
    this.status(convert ? "buffering…" : "starting…");
    let info;
    try { info = await Emby.videoStream(this.v.id, { convert }); }
    catch (e) { if (this.el && gen === this.startGen) this.status("couldn't start this — " + lower(e.message)); return; }
    if (!this.el || gen !== this.startGen) { Emby.report("stop", info, from, true); return; } // left meanwhile
    this.info = info;
    if (info.hls && !v.native && window.Hls && Hls.isSupported()) {
      let recovered = false;
      const hls = this.hls = new Hls({ startPosition: from || -1, xhrSetup: (xhr, url) => { const u = info.withKey(url); if (u !== url) xhr.open("GET", u, true); } });
      hls.on(Hls.Events.ERROR, (e, d) => {
        if (!d.fatal || hls !== this.hls) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); } // a glitch: try to ride over it first
        else this.trouble();
      });
      hls.loadSource(info.url);
      hls.attachMedia(v);
    } else {
      v.src = info.url;
      if (from) v.addEventListener("loadedmetadata", () => { v.currentTime = from; }, { once: true });
    }
    v.play().catch(() => {});
    Emby.report("start", info, from, false);
    clearInterval(this.reportTimer);
    // every 2 seconds: Emby (and plugins like ComSkipper) act on where you are, so a skip lands right as the break starts
    this.reportTimer = setInterval(() => Emby.report("progress", info, v.currentTime, v.paused), 2000);
  }
  // Playback broke (Edge couldn't decode the file, or the stream fell over): close that attempt and
  // pick up from the same spot (a couple of seconds back) with Emby converting the video. It only
  // gives up — with a plain message — if that keeps failing at the same place.
  trouble() {
    if (!this.el || this.done || this.fixing) return;
    const v = this.video, pos = v.currentTime || this.lastFrom || this.from || 0;
    if (Math.abs(pos - (this.lastFrom || 0)) > 120) this.tries = 0; // it played fine for a while since the last fix
    this.tries = (this.tries || 0) + 1;
    if (this.tries > 3) {
      this.status("this video can't be played right now — emby couldn't convert it either. press back to return.");
      return;
    }
    this.fixing = true;
    this.lastFrom = Math.max(0, pos - 2);
    clearInterval(this.reportTimer);
    if (this.info) Emby.report("stop", this.info, pos, true);
    if (this.hls) { const h = this.hls; this.hls = null; h.destroy(); }
    v.pause(); v.removeAttribute("src"); v.load();
    this.start(this.lastFrom, true).finally(() => { this.fixing = false; });
  }
  unmount() {
    if (this.nextUp) { clearInterval(this.nextUp.timer); this.nextUp = null; }
    if (this.keepOnLeave) { // Back while it plays: it carries on behind the menus (BgVod), Emby still told where you are
      this.keepOnLeave = false;
      BgVod.take(this);
    } else this.stopPlayback();
    super.unmount();
  }
  // the end of this movie's playback: Emby is told where you stopped, and the stream is closed
  stopPlayback() {
    this.startGen++; // a start still on its way is dropped
    clearInterval(this.reportTimer);
    const v = this.video;
    if (this.info && !this.done) Emby.report("stop", this.info, v.currentTime, true);
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    v.pause(); v.removeAttribute("src"); v.load();
  }
  leave() {
    if (this.keepOnLeave) return Promise.resolve(); // (the picture stays up, it only moves behind the menus)
    return done(this.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }));
  }
  live() {}
  get dur() { const d = this.video.duration; return isFinite(d) && d > 0 ? d : (this.info && this.info.dur) || this.v.runtime || 0; }
  fill() {
    if (!this.el) return;
    const v = this.v, ep = v.type === "Episode" && !v.rec, pos = this.video.currentTime || 0, d = this.dur;
    this.q(".lv-ch").textContent = v.rec ? ["recorded", v.channel, v.when ? homeDate(v) : ""].filter(Boolean).join("  ") : ep ? (v.seriesName || "tv shows") : v.home ? ["home video", homeDate(v)].filter(Boolean).join("  ") : ["movie", v.year].filter(Boolean).join("  ");
    this.q(".lv-title").textContent = v.title;
    this.q(".lv-sub").textContent = [v.rec ? v.ep : ep ? `season ${v.season || "?"} · episode ${v.episode || "?"}` : v.rating, v.recording ? "still recording" : "", this.video.paused && this.info ? "paused" : ""].filter(Boolean).join(" · ");
    this.q(".lv-ov div").textContent = v.overview || "no description.";
    this.q(".lv-times .a").textContent = fmtT(pos);
    this.q(".lv-times .b").textContent = d ? "-" + fmtT(Math.max(0, d - pos)) : "";
    qa(this.el, ".lv-bar i").forEach(i => { i.style.width = d ? Math.min(100, pos / d * 100) + "%" : "0"; });
    qa(this.el, ".lv-bar").forEach(b => { b.style.visibility = d ? "" : "hidden"; });
    this.q(".lv-peek-txt").textContent = `${fmtT(pos)} / ${fmtT(d)}`;
    const paused = this.video.paused, play = this.btnEls[VOD_PLAY];
    play.querySelector(".ring").innerHTML = paused ? ICON.play : ICON.pause;
    play.querySelector(".lbl").textContent = paused ? "play" : "pause";
  }
  togglePause() {
    const v = this.video;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    this.pauseGlyph(v.paused);
    if (this.info) Emby.report("progress", this.info, v.currentTime, v.paused);
    this.fill();
  }
  seek(by) {
    const v = this.video, d = this.dur;
    if (!d) return;
    v.currentTime = clamp(v.currentTime + by, 0, Math.max(0, d - 1));
    this.glyph(by < 0 ? `−${-by}` : `+${by}`);
    this.peek();
  }
  // jump to an exact time (Emby remote control — e.g. ComSkipper jumping over a commercial)
  seekTo(t) {
    const v = this.video, d = this.dur;
    v.currentTime = clamp(t, 0, d ? Math.max(0, d - 1) : t);
    this.peek();
    if (this.info) Emby.report("progress", this.info, v.currentTime, v.paused);
  }
  press(id) {
    if (id === "play") return this.togglePause();
    if (id === "rw" || id === "ff") return this.seek(skipBy(id === "ff" ? 1 : -1));
    if (id === "start") { this.video.currentTime = 0; this.glyph("start"); this.fill(); return; }
    if (id === "stop") return back();
    if (id === "info") {
      const open = this.q(".lv-osd").classList.toggle("info");
      if (open) clearTimeout(this.osdTimer); else this.arm("osdHide");
    }
    this.fill();
  }
  finished() {
    this.done = true;
    clearInterval(this.reportTimer);
    if (this.info) Emby.report("stop", this.info, this.dur, false); // the end: Emby marks it watched
    if (BgVod.page === this) { BgVod.stop(); return; } // it ended behind the menus
    if (top() !== this) return;
    // settings → playback → next episode plays: count down, then the next episode takes this screen's place
    const secs = Number(Prefs.get("nextEp")) || 0, v = this.v;
    if (!secs || v.type !== "Episode" || v.rec || !v.seriesId) return back();
    Emby.nextEpisode(v).then(next => (next ? this.upNext(next, secs) : back()), () => back());
  }
  upNext(next, secs) {
    if (!this.el || top() !== this) return;
    this.status("");
    const box = el("div", "lv-next");
    this.el.append(box);
    let left = secs;
    const show = () => { box.innerHTML = `<div class="sc">up next in ${left}</div><div class="nt">${esc(next.title)}</div><div class="sc">season ${next.season || "?"} · episode ${next.episode || "?"} — enter plays now · back stops</div>`; };
    show();
    this.nextUp = { next, timer: setInterval(() => { if (--left <= 0) this.playNext(); else show(); }, 1000) };
  }
  playNext() {
    const n = this.nextUp; if (!n) return;
    clearInterval(n.timer); this.nextUp = null;
    if (top() === this) go(new VodPage(n.next, n.next.resume > 60 ? n.next.resume : 0), { replace: true });
  }
  cancelNext() {
    const n = this.nextUp; if (!n) return false;
    clearInterval(n.timer); this.nextUp = null;
    back();
    return true;
  }
  playKey() { this.togglePause(); return true; }
  skip(dir) { this.seek(skipBy(dir)); } // (voice: "skip ahead / back")
  changeChannel() {}
  mediaKey(k) {
    if (k === "stop") { back(); return true; }
    if (k === "next" || k === "prev") { this.seek(skipBy(k === "next" ? 1 : -1)); return true; }
    return false;
  }
  key(k) {
    if (this.nextUp) { if (k === "ok") this.playNext(); else if (k === "back") this.cancelNext(); return true; }
    if (k === "back") {
      if (this.infoOpen()) { this.q(".lv-osd").classList.remove("info"); this.arm("osdHide"); return true; }
      if (this.mode === "controls") { this.setMode("hidden"); return true; }
      // leave: the movie keeps playing behind the menus, like live tv (Back on the home menu brings it back)
      this.keepOnLeave = !NATIVE && !!this.info && !this.done;
      return false;
    }
    if (this.mode === "controls") {
      if (k === "left" || k === "right") this.focusBtn(k === "left" ? -1 : 1);
      else if (k === "ok") this.press(this.btnEls[this.bi].dataset.id);
      if (this.mode === "controls" && !this.infoOpen()) this.arm("osdHide");
      return true;
    }
    if (k === "ok") { this.bi = VOD_PLAY; this.controls(); return true; }
    if (k === "left" || k === "right") { this.seek(skipBy(k === "right" ? 1 : -1)); return true; }
    return true;
  }
}

/* ============ a movie or show playing behind the menus ============
   Back from a movie or episode (with nothing on screen) doesn't stop it: like live tv it carries on behind
   the menus (settings → appearance → tv behind menus: full screen and dimmed, or the small corner window).
   Back on the home menu, or "show the player" by voice, brings it full screen again. Starting live tv, music,
   radio, youtube or another video stops it, and Emby is told where you stopped. */
const BgVod = {
  page: null, // the movie's screen (closed) whose video is still playing
  get active() { return !!this.page; },
  init() {
    this.layer = el("div", "vlayer vodlayer off");
    this.layer.append(el("div", "vl-scrim"));
    $stage.insertBefore(this.layer, $pages);
  },
  take(page) { this.page = page; this.layer.prepend(page.video); },
  give(page) { // the movie's screen is opening again: its video goes back to it
    if (this.page !== page) return null;
    this.page = null;
    this.place();
    return page.video;
  },
  place(p = top()) {
    if (!this.layer) return;
    const mode = this.page && this.page !== p ? Live.bgMode : "off";
    this.layer.classList.remove("off", "behind", "corner");
    this.layer.classList.add(mode);
    const chip = Live.chip;
    if (mode !== "off") {
      chip.innerHTML = `<b>${this.page.video.paused ? "paused" : "playing"}</b> ${esc(videoTitle(this.page.v))}`;
      chip.classList.add("on");
    } else if (!Live.active) chip.classList.remove("on");
  },
  togglePause() {
    const pg = this.page; if (!pg) return false;
    const v = pg.video;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    if (pg.info) Emby.report("progress", pg.info, v.currentTime, v.paused);
    this.place();
    return true;
  },
  stop() {
    const pg = this.page; if (!pg) return;
    this.page = null;
    pg.stopPlayback();
    pg.video.remove();
    this.place();
  },
};

/* ============ watching a youtube video ============
   YouTube's own embedded player, full screen, with its controls hidden and the app's Zune-style ones
   on top (same keys as movies). It picks up where you left off, and remembers your place. Videos
   whose owners don't allow playback outside YouTube offer VacuumTube instead. */
const YTApi = {
  ready: null,
  load() {
    if (this.ready) return this.ready;
    this.ready = new Promise((res, rej) => {
      if (window.YT && window.YT.Player) return res(window.YT);
      window.onYouTubeIframeAPIReady = () => res(window.YT);
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => { this.ready = null; rej(new Error("youtube's player didn't load")); };
      document.head.append(s);
    });
    return this.ready;
  },
};
const YT_BUTTONS = [
  VOD_BUTTONS.find(b => b[0] === "start"), VOD_BUTTONS.find(b => b[0] === "rw"), ["play", "pause", ""],
  VOD_BUTTONS.find(b => b[0] === "ff"), PLAYER_BUTTONS.find(b => b[0] === "cc"),
  VOD_BUTTONS.find(b => b[0] === "stop"), VOD_BUTTONS.find(b => b[0] === "info"),
];
const YT_PLAY = YT_BUTTONS.findIndex(b => b[0] === "play");
function playYouTube(v) { go(new YtPage(v)); }

class YtPage extends LivePage {
  constructor(v) { super({ channels: [] }, 0); this.v = v; this.bi = YT_PLAY; }
  get ch() { return null; }
  get titleKey() { return null; }
  buttons() { return YT_BUTTONS; }
  render() {
    const r = super.render();
    r.classList.add("vod-page", "yt-page");
    this.host = el("div", "yt-host"); this.host.append(el("div", "yt-frame"));
    r.prepend(this.host);
    return r;
  }
  async mounted() {
    Live.stop(); BgVod.stop();
    if (Player.playing) Player.toggle(); // music pauses while a video plays
    this.status("starting…");
    let api;
    try { api = await YTApi.load(); } catch (e) { if (this.el) this.status(lower(e.message)); return; }
    if (!this.el) return;
    const from = Tube.posOf(this.v.id);
    this.player = new api.Player(this.host.querySelector(".yt-frame"), {
      videoId: this.v.id, width: 1920, height: 1080,
      playerVars: {
        autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1,
        cc_load_policy: this.ccOn ? 1 : 0, cc_lang_pref: "en", start: from > 30 ? Math.floor(from) : 0, origin: location.origin,
      },
      events: {
        onReady: e => { if (!this.el) return; this.ready = true; window.__ytPlayer = e.target; Volume.apply(); e.target.playVideo(); this.banner(); this.enforceCaptions(); },
        // YouTube loads its captions on its own (it remembers them being on from any earlier video): keep them to your choice
        onApiChange: () => this.enforceCaptions(),
        onStateChange: e => this.playerState(e.data),
        onError: e => this.playerError(e.data),
      },
    });
    this.saveTimer = setInterval(() => this.savePos(), 5000);
  }
  unmount() {
    this.savePos();
    clearInterval(this.saveTimer); clearInterval(this.ccHold);
    if (window.__ytPlayer === this.player) window.__ytPlayer = null;
    try { this.player && this.player.destroy(); } catch {}
    super.unmount();
  }
  leave() { return done(this.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" })); }
  live() {}
  get pos() { try { return this.ready ? this.player.getCurrentTime() || 0 : 0; } catch { return 0; } }
  get dur() { try { return (this.ready && this.player.getDuration()) || this.v.runtime || 0; } catch { return this.v.runtime || 0; } }
  get isPaused() { try { return !this.ready || this.player.getPlayerState() !== 1; } catch { return true; } } // ("paused" is the controls' own pause marker)
  playerState(s) {
    if (s === 1) { // playing
      this.status("");
      // YouTube switches captions on by itself a few seconds into a video (it remembers them from any
      // earlier one): hold your choice through the first 20 seconds of play
      this.enforceCaptions();
      if (!this.ccHold) {
        let n = 0;
        this.ccHold = setInterval(() => { if (!this.el || ++n > 10) return clearInterval(this.ccHold); this.enforceCaptions(); }, 2000);
      }
    }
    else if (s === 3) this.status("buffering…");
    else if (s === 0) return this.finished();     // ended
    if (this.mode !== "hidden") this.fill();
  }
  playerError(code) {
    this.blocked = true;
    this.status(code === 101 || code === 150 ? "this video's owner doesn't allow it to play here — press enter to open it in vacuumtube"
      : code === 100 ? "this video isn't available any more" : "youtube couldn't play this video — press enter to try vacuumtube");
  }
  savePos() {
    if (!this.ready || this.v.live) return;
    const t = this.pos, d = this.dur;
    Tube.setPos(this.v.id, d && t > 30 && t < d - 30 ? t : 0); // near the start or the end: nothing to resume
  }
  finished() { this.done = true; Tube.setPos(this.v.id, 0); if (top() === this) back(); }
  fill() {
    if (!this.el) return;
    const v = this.v, pos = this.pos, d = this.dur;
    this.q(".lv-ch").textContent = v.channel || "youtube";
    this.q(".lv-title").textContent = v.title;
    this.q(".lv-sub").textContent = [v.live ? "live" : "", viewCount(v.views), v.when ? ago(v.when) : "", this.isPaused && this.ready ? "paused" : ""].filter(Boolean).join(" · ");
    this.q(".lv-ov div").textContent = (v.overview || "no description.").slice(0, 600);
    this.q(".lv-times .a").textContent = fmtT(pos);
    this.q(".lv-times .b").textContent = d && !v.live ? "-" + fmtT(Math.max(0, d - pos)) : "";
    qa(this.el, ".lv-bar i").forEach(i => { i.style.width = d && !v.live ? Math.min(100, pos / d * 100) + "%" : "0"; });
    qa(this.el, ".lv-bar").forEach(b => { b.style.visibility = d && !v.live ? "" : "hidden"; });
    this.q(".lv-peek-txt").textContent = `${fmtT(pos)} / ${fmtT(d)}`;
    const play = this.btnEls[YT_PLAY], paused = this.isPaused;
    play.querySelector(".ring").innerHTML = paused ? ICON.play : ICON.pause;
    play.querySelector(".lbl").textContent = paused ? "play" : "pause";
    const cc = this.btnEls.find(b => b.dataset.id === "cc");
    if (cc) { cc.querySelector(".lbl").textContent = this.ccOn ? "cc on" : "cc off"; cc.classList.toggle("lit", this.ccOn); }
  }
  togglePause() {
    if (!this.ready) return;
    if (this.isPaused) this.player.playVideo(); else this.player.pauseVideo();
    setTimeout(() => { this.pauseGlyph(this.isPaused); this.fill(); }, 150);
  }
  seek(by) {
    if (!this.ready || this.v.live) return;
    this.player.seekTo(clamp(this.pos + by, 0, Math.max(0, this.dur - 1)), true);
    this.glyph(by < 0 ? `−${-by}` : `+${by}`);
    this.peek();
  }
  seekTo(t) { if (this.ready && !this.v.live) { this.player.seekTo(clamp(t, 0, Math.max(0, this.dur - 1)), true); this.peek(); } }
  // YouTube's captions have their own on / off, separate from live tv's (settings are remembered)
  get ccOn() { return !!Prefs.get("ytcc"); }
  enforceCaptions() {
    if (!this.ready) return;
    try {
      // (YouTube's "current track" report goes stale after captions are switched off, so this goes by
      // whether its captions module is loaded, which it reports reliably)
      const loaded = ((this.player.getOptions && this.player.getOptions()) || []).some(m => m === "captions" || m === "cc");
      if (this.ccOn) {
        if (!loaded) this.player.loadModule("captions"); // YouTube calls back (onApiChange) once it's in
        else this.player.setOption("captions", "track", { languageCode: "en" });
      } else if (loaded) {
        this.player.unloadModule("captions"); this.player.unloadModule("cc");
      }
    } catch { /* captions not loaded yet; YouTube calls back when they are */ }
  }
  press(id) {
    if (id === "play") return this.togglePause();
    if (id === "rw" || id === "ff") return this.seek(skipBy(id === "ff" ? 1 : -1));
    if (id === "start") { if (this.ready) this.player.seekTo(0, true); this.glyph("start"); return; }
    if (id === "stop") return back();
    if (id === "cc") {
      Prefs.set("ytcc", !this.ccOn);
      // YouTube loads / drops its captions in its own time: apply now, then make sure it took
      this.enforceCaptions(); [600, 1500, 3000].forEach(t => setTimeout(() => this.el && this.enforceCaptions(), t));
      toast(this.ccOn ? "captions on" : "captions off");
    }
    if (id === "info") {
      const open = this.q(".lv-osd").classList.toggle("info");
      if (open) clearTimeout(this.osdTimer); else this.arm("osdHide");
    }
    this.fill();
  }
  playKey() { this.togglePause(); return true; }
  skip(dir) { this.seek(skipBy(dir)); }
  changeChannel() {}
  mediaKey(k) {
    if (k === "stop") { back(); return true; }
    if (k === "next" || k === "prev") { this.seek(skipBy(k === "next" ? 1 : -1)); return true; }
    return false;
  }
  key(k) {
    if (this.blocked && k === "ok") { Apps.launch(); return true; } // can't play here: VacuumTube instead
    if (k === "back") {
      if (this.infoOpen()) { this.q(".lv-osd").classList.remove("info"); this.arm("osdHide"); return true; }
      if (this.mode === "controls") { this.setMode("hidden"); return true; }
      return false; // leave: your place is remembered
    }
    if (this.mode === "controls") {
      if (k === "left" || k === "right") this.focusBtn(k === "left" ? -1 : 1);
      else if (k === "ok") this.press(this.btnEls[this.bi].dataset.id);
      if (this.mode === "controls" && !this.infoOpen()) this.arm("osdHide");
      return true;
    }
    if (k === "ok") { this.bi = YT_PLAY; this.controls(); return true; }
    if (k === "left" || k === "right") { this.seek(skipBy(k === "right" ? 1 : -1)); return true; }
    return true;
  }
}

/* ============ sections not built yet ============ */
class Placeholder extends Page {
  constructor(name, note) { super(); this.name = name; this.heroName = name; this.note = note; }
  get titleKey() { return this.name; }
  render() {
    const r = el("div", "sub-page");
    r.append(el("div", "sec-title z", esc(this.name)), el("div", "ph-sub zs", "coming soon"),
      el("div", "ph-note t", esc(this.note || "this section will show your emby library.")));
    return r;
  }
}

function sectionPage(id) {
  if (id === "music") return musicPage();
  if (id === "settings") return new SettingsPage();
  if (id === "movies") return Emby.connected ? moviesPage() : needEmby(id);
  if (id === "tv shows") return Emby.connected ? tvPage() : needEmby(id);
  if (id === "tv guide") return new GuidePage();
  if (id === "youtube") return youtubePage();
  if (id === "recordings") return Emby.connected ? recordingsPage() : needEmby(id);
  if (id === "home videos") return Emby.connected ? homeVideosPage() : needEmby(id);
  if (id === "pictures") return Emby.connected ? picturesPage() : needEmby(id);
  if (id === "radio") return radioPage();
  return new Placeholder(id);
}

/* ============ settings ============
   Sections like the rest of the app: EMBY SERVER · APPEARANCE · PLAYBACK.
   Focus starts on the section labels (←/→ switches, ↓ goes in, ↑ from the top comes back).
   Option rows: ←/→ (or Enter) changes the value, and it takes effect right away. */
const LIB_TYPE = { movies: "movies", tvshows: "tv shows", music: "music", livetv: "live tv", homevideos: "videos", photos: "pictures", playlists: "playlists", boxsets: "collections" };
const SECONDS = (list, never = "never") => list.map(n => [n, n ? `${n} seconds` : never]);

const SETTINGS_TABS = [
  { name: "emby server", build: "emby" },
  { name: "hub menu", build: "menu" },
  {
    name: "appearance",
    options: [
      { label: "text color", values: () => Theme.COLORS.map(c => [c[0], c[0]]), get: () => Theme.fg, set: v => { Theme.save({ fg: v }); Theme.apply(); } },
      { label: "background", values: () => Art.walls.map(w => [w, w]), get: () => Theme.bg, set: v => { Theme.save({ bg: v }); Theme.apply(); } },
      { label: "tv behind menus", values: () => [["behind", "full screen"], ["corner", "small corner window"]], get: () => Live.bgMode, set: v => { Live.bgMode = v; } },
      // how now playing opens (and closes) when you play an album, a song or a playlist
      { label: "now playing animation", values: () => [["zoom", "zoom (the usual)"], ["dock", "swing in (zune dock)"]], get: () => Prefs.get("npAnim"), set: v => Prefs.set("npAnim", v) },
      { label: "text size", values: () => [["normal", "normal"], ["large", "large"]], get: () => Prefs.get("textSize"), set: v => { Prefs.set("textSize", v); applyTextSize(); } },
      { label: "clock", values: () => [["12", "12-hour"], ["24", "24-hour"], ["off", "hidden"]], get: () => Prefs.get("clock"), set: v => { Prefs.set("clock", v); clock(); } },
      { label: "start on", values: () => [["home", "home menu"], ...MENU_ALL.map(id => [id, lower(MENU_LABEL[id] || id)]), ["live", "last channel watched"]], get: () => Prefs.get("startup"), set: v => Prefs.set("startup", v) },
    ],
  },
  {
    name: "playback",
    options: [
      { label: "music info hides after", values: () => SECONDS([0, 3, 5, 8, 10, 15]), get: () => Prefs.get("npHide"), set: v => Prefs.set("npHide", v) },
      { label: "music screensaver", values: () => [[0, "off"], [30, "after 30 seconds"], [60, "after 1 minute"], [120, "after 2 minutes"], [300, "after 5 minutes"]], get: () => Prefs.get("saver"), set: v => { Prefs.set("saver", v); Saver.poke(); } },
      { label: "screensaver look", values: () => [["zune", "zune hd (moving letters)"], ["crawl", "scrolling text + bio"]], get: () => Prefs.get("saverLook"), set: v => Prefs.set("saverLook", v) },
      // when nothing is playing (any key just wakes it)
      { label: "idle screensaver", values: () => [[0, "off"], [2, "after 2 minutes"], [5, "after 5 minutes"], [10, "after 10 minutes"], [15, "after 15 minutes"]], get: () => Prefs.get("idleSaver"), set: v => { Prefs.set("idleSaver", v); Saver.poke(); } },
      { label: "idle screensaver look", values: () => [["backdrops", "backdrops"], ["bands", "zune bands"], ["wall", "cover wall"]], get: () => Prefs.get("idleLook"), set: v => Prefs.set("idleLook", v) },
      ...IDLE_KINDS.map(([k, name]) => ({ label: "idle screensaver: " + name, values: () => [[true, "on"], [false, "off"]], get: () => !!Prefs.get("idle_" + k), set: v => { Prefs.set("idle_" + k, v); IdleSaver.poolAt = 0; } })),
      { label: "album art when info hides", values: () => [["hide", "hide it"], ["center", "move to the middle"]], get: () => Prefs.get("npArt"), set: v => Prefs.set("npArt", v) },
      { label: "live tv info hides after", values: () => SECONDS([0, 3, 5, 8, 10]), get: () => Prefs.get("liveHide"), set: v => Prefs.set("liveHide", v) },
      { label: "player controls hide after", values: () => SECONDS([0, 3, 5, 8, 10, 15]), get: () => Prefs.get("osdHide"), set: v => Prefs.set("osdHide", v) },
      { label: "skip back (←)", values: () => [5, 10, 15, 30].map(n => [n, `${n} seconds`]), get: () => Number(Prefs.get("skipBack")), set: v => Prefs.set("skipBack", v) },
      { label: "skip ahead (→)", values: () => [10, 15, 30, 60].map(n => [n, `${n} seconds`]), get: () => Number(Prefs.get("skipFwd")), set: v => Prefs.set("skipFwd", v) },
      { label: "next episode plays", values: () => [[0, "off"], [5, "after 5 seconds"], [10, "after 10 seconds"], [20, "after 20 seconds"]], get: () => Number(Prefs.get("nextEp")), set: v => Prefs.set("nextEp", v) },
      { label: "sleep timer", values: () => Sleep.values(), get: () => Sleep.mins, set: v => Sleep.set(v) },
      { label: "picture in picture", values: () => [["four", "one big + three small"], ["two", "side by side (2 channels)"]], get: () => Prefs.get("pip"), set: v => Prefs.set("pip", v) },
      { label: "music volume", values: () => [100, 80, 60, 40].map(n => [n, `${n}%`]), get: () => Prefs.get("musicVol"), set: v => { Prefs.set("musicVol", v); Volume.apply(); } },
      ...(NATIVE ? [{ // the Shield switches the TV to the film's frame rate (no judder on 24p films)
        label: "match frame rate", values: () => [["on", "on (movies & shows)"], ["off", "off"]],
        get: () => Prefs.get("fps"), set: v => { Prefs.set("fps", v); NATIVE.matchFrameRate(v !== "off"); },
      }] : []),
    ],
  },
  { name: "channels", build: "channels" },
  { name: "radio", build: "radio" },
  { name: "youtube", build: "youtube" },
  { name: "apps", build: "apps" },
];

class SettingsPage extends Page {
  constructor() {
    super();
    this.heroName = "settings";
    this.tab = 0; this.zone = "head"; this.f = 0; this.msg = null; this.working = false;
  }
  get titleKey() { return "settings"; }
  // like the other sections, the giant title drifts a little as you move between tabs
  titlePan() { return `${-this.tab * TITLE_PAN}px 0px`; }
  render() {
    const s = Emby.state;
    this.vals = this.vals || { server: s.server || "", user: s.userName || "", pw: "" };
    const r = el("div", "settings-page pivot-page");
    this.root = r;
    this.titleEl = el("div", "sec-title z", "settings");
    this.titleEl.style.translate = this.titlePan();
    r.append(this.titleEl);
    const clip = el("div", "pivot-clip zs");
    this.strip = el("div", "pivot-strip");
    this.tabEls = SETTINGS_TABS.map((t, i) => { const e = el("div", "pv", esc(t.name)); this.strip.append(e); return e; });
    clip.append(this.strip); r.append(clip);
    // the content scrolls inside a window that fades out under the tab names (no scroll bar)
    const win = el("div", "set-clip");
    this.body = el("div", "set-body"); win.append(this.body); r.append(win);
    this.buildTab();
    return r;
  }
  mounted() { if (this.tab === 0 && Emby.connected) this.loadLibs(); }

  // ----- building each section -----
  buildTab() {
    this.body.innerHTML = "";
    this.bodyScroll = 0; // a new tab starts at the top
    this.body.style.transition = "none"; this.body.style.translate = "0 0"; void this.body.offsetWidth; this.body.style.transition = "";
    this.libsEl = null;
    this.rows = []; this.statusEl = null; this.vaStatusEl = null;
    const t = SETTINGS_TABS[this.tab];
    const build = { emby: () => this.buildEmby(), menu: () => this.buildMenu(), channels: () => this.buildChannels(), radio: () => this.buildRadio(), youtube: () => this.buildYouTube(), apps: () => this.buildApps() };
    this.items = t.options ? this.buildOptions(t.options) : build[t.build]();
    this.f = clamp(this.f, 0, this.items.length - 1);
    this.paint();
  }
  buildOptions(options) {
    return options.map(o => {
      const row = el("div", "opt-row t", `<div class="lab">${esc(o.label)}</div><div class="btn"></div>`);
      row.opt = o;
      this.body.append(row);
      this.showValue(row);
      return row;
    });
  }
  showValue(row) {
    const o = row.opt, list = o.values(), cur = list.find(v => v[0] === o.get());
    row.querySelector(".btn").textContent = cur ? cur[1] : String(o.get());
  }
  // move an option to its next (dir 1) or previous (dir -1) value and apply it right away
  cycle(row, dir) {
    const o = row.opt, list = o.values();
    const i = list.findIndex(v => v[0] === o.get());
    o.set(list[(i + dir + list.length) % list.length][0]);
    this.showValue(row);
    applyBg(this); // shows a new background / tv style immediately
  }
  // a text box row (Enter to type; Enter again or up/down to finish)
  makeField(fd, form) {
    const row = el("div", "field t", `<div class="lab">${esc(fd.label)}</div>`);
    const input = el("input", "val");
    Object.assign(input, { type: fd.secret ? "password" : "text", placeholder: fd.ph || "", value: this.vals[fd.id] || "", tabIndex: -1, spellcheck: false, autocomplete: "off" });
    row.append(input); row.input = input; row.fd = fd;
    // keep the value however it got there: typing, mouse clicks, paste or browser autofill
    input.addEventListener("input", () => { this.vals[fd.id] = input.value; });
    input.addEventListener("focus", () => {
      row.classList.add("editing");
      const i = this.items.indexOf(row); if (i >= 0) { this.zone = "body"; this.f = i; this.paint(); }
    });
    input.addEventListener("blur", () => { this.vals[fd.id] = input.value; row.classList.remove("editing"); });
    form.append(row); this.rows.push(row);
    return row;
  }
  makeButtons(form, btns) {
    const btnRow = el("div", "btn-row");
    const els = btns.map(b => { const e = el("div", "btn t", esc(b.label)); e.b = b; btnRow.append(e); return e; });
    form.append(btnRow);
    return els;
  }
  setStatus(text, kind = "") {
    if (!this.statusEl) return;
    this.statusEl.className = "status t" + (kind ? " " + kind : "");
    this.statusEl.textContent = text;
  }
  buildEmby() {
    const form = el("div", "form"); this.body.append(form);
    [
      { id: "server", label: "server address", ph: "e.g. 192.168.1.20:8096" },
      { id: "user", label: "username", ph: "" },
      { id: "pw", label: "password", ph: Emby.connected ? "(saved — only needed to sign in again)" : "", secret: true },
    ].forEach(fd => this.makeField(fd, form));
    const btns = [{ id: "connect", label: Emby.connected ? "sign in again" : "connect" }];
    if (Emby.connected) btns.push({ id: "signout", label: "sign out" });
    this.btnEls = this.makeButtons(form, btns);
    this.statusEl = el("div", "status t"); form.append(this.statusEl);
    this.libsEl = el("div", "libs"); this.body.append(this.libsEl);
    this.showStatus();
    return [...this.rows, ...this.btnEls];
  }
  // hub menu: left/right moves the item up/down the menu, Enter shows or hides it. Settings always stays last.
  buildMenu() {
    const rows = menuLayout().map(([id, on]) => {
      const row = el("div", "opt-row t", `<div class="lab">${esc(MENU_LABEL[id] || id)}</div><div class="btn">${on ? "shown" : "hidden"}</div>`);
      row.menuId = id; row.classList.toggle("off", !on);
      this.body.append(row); return row;
    });
    // the hint sits beside the list (below it, it ran off the bottom of the screen)
    this.body.append(el("div", "set-note side t", "← → moves an item up or down the menu<br>enter shows or hides it<br>settings always stays last"));
    return rows;
  }
  // channels: the guide options, then every channel — Enter (or ← →) goes shown → favorite → hidden
  buildChannels() {
    const opts = this.buildOptions([
      { label: "channel numbers in guide", values: () => [["on", "show"], ["off", "hide"]], get: () => Prefs.get("guideNums"), set: v => Prefs.set("guideNums", v) },
      { label: "guide shows", values: () => [2, 3, 4].map(n => [n, `${n} hours at a time`]), get: () => Number(Prefs.get("guideSpan")), set: v => Prefs.set("guideSpan", v) },
      { label: "guide enter", values: () => [["info", "show info first"], ["tune", "tune right away"]], get: () => Prefs.get("guideOk"), set: v => Prefs.set("guideOk", v) },
      { label: "guide opens on", values: () => [[true, "last channel watched"], [false, "the first channel"]], get: () => !!Prefs.get("lastCh"), set: v => Prefs.set("lastCh", v) },
    ]);
    this.body.append(el("div", "set-note ch-note t", Emby.connected ? "your channels — enter: shown → favorite (top of the guide) → hidden" : "sample channels — sign in to emby to set up your own"));
    const box = el("div", "ch-list"); this.body.append(box);
    const tab = this.tab;
    Promise.resolve().then(() => Emby.connected ? Emby.channels() : SampleGuide.channels()).then(chans => {
      if (!this.el || this.tab !== tab || !box.isConnected) return;
      const rows = chans.map(ch => {
        const row = el("div", "opt-row t", `<div class="lab">${esc([ch.number, ch.name].filter(Boolean).join("  "))}</div><div class="btn"></div>`);
        row.chId = ch.id; this.showChannel(row); box.append(row); return row;
      });
      this.items = [...opts, ...rows]; this.paint();
    }, e => { if (box.isConnected) box.append(el("div", "set-note t", "couldn't load the channels — " + esc(lower(e.message)))); });
    return opts;
  }
  showChannel(row) {
    const id = row.chId, hidden = (Prefs.get("chHidden") || []).includes(id), fav = (Prefs.get("chFav") || []).includes(id);
    row.querySelector(".btn").textContent = hidden ? "hidden" : fav ? "★ favorite" : "shown";
    row.classList.toggle("off", hidden);
  }
  cycleChannel(row, dir) {
    const id = row.chId, without = k => (Prefs.get(k) || []).filter(x => x !== id);
    const states = ["shown", "fav", "hidden"];
    const cur = (Prefs.get("chHidden") || []).includes(id) ? 2 : (Prefs.get("chFav") || []).includes(id) ? 1 : 0;
    const next = states[(cur + dir + 3) % 3];
    Prefs.set("chHidden", next === "hidden" ? [...without("chHidden"), id] : without("chHidden"));
    Prefs.set("chFav", next === "fav" ? [...without("chFav"), id] : without("chFav"));
    this.showChannel(row);
  }
  moveMenu(id, d) {
    const layout = menuLayout(), i = layout.findIndex(([x]) => x === id), j = i + d;
    if (j < 0 || j >= layout.length) return;
    [layout[i], layout[j]] = [layout[j], layout[i]];
    Prefs.set("menu", layout);
    this.buildTab(); this.f = j; this.paint();
  }
  toggleMenu(id) {
    const layout = menuLayout(), item = layout.find(([x]) => x === id);
    if (item[1] && layout.filter(([, on]) => on).length === 1) return toast("at least one item has to stay on the menu");
    item[1] = !item[1];
    Prefs.set("menu", layout);
    const f = this.f; this.buildTab(); this.f = f; this.paint();
  }
  // one column: the stations' listen key, then the fanart.tv key for big artist pictures
  buildRadio() {
    const form = el("div", "form stack"); this.body.append(form);
    const sec = t => form.append(el("div", "set-sec t", esc(t)));
    sec("stations");
    if (this.vals.radioKey === undefined) this.vals.radioKey = Prefs.get("radioKey") || "";
    const kfield = this.makeField({ id: "radioKey", label: "listen key", ph: "your premium listen key", secret: true }, form);
    const btns = this.makeButtons(form, [{ id: "saveRadio", label: "save" }]);
    this.statusEl = el("div", "status t"); form.append(this.statusEl);
    form.append(el("div", "set-note t", "one premium listen key works for di.fm, radiotunes, jazzradio, rockradio, classical radio and zenradio. find it on any of those sites under player settings → hardware player."));
    this.setStatus(Radio.key ? "a listen key is saved" : "no listen key yet", Radio.key ? "ok" : "");

    // the key itself stays with the helper (tools/apps.json), never in the app
    sec("artist pictures");
    this.vals.fanartKey = this.vals.fanartKey || "";
    const ffield = this.makeField({ id: "fanartKey", label: "fanart.tv key", ph: "your personal api key from fanart.tv", secret: true }, form);
    const fbtns = this.makeButtons(form, [{ id: "saveFanart", label: "save" }, { id: "clearFanart", label: "remove" }]);
    this.vaStatusEl = el("div", "status t"); form.append(this.vaStatusEl);
    form.append(el("div", "set-note t", "while radio plays, big photos of the artist slide behind the song (your emby pictures first when you have the artist). with a fanart.tv key there are many more, and wide ones. artists with no photos anywhere get their song cover, blurred."));
    this.vaStatus("checking…");
    Apps.call("/apps/fanart").then(st => {
      if (!this.el || !this.vaStatusEl || SETTINGS_TABS[this.tab].build !== "radio") return;
      if (st.server === false) return this.vaStatus("the helper isn't running — start the app with “Start Media Center”", "err");
      if (st.set && !ffield.input.value) ffield.input.placeholder = "saved — type a new one to replace it";
      this.vaStatus(st.set ? "a fanart.tv key is saved" : "no fanart.tv key yet — only deezer photos for now", st.set ? "ok" : "");
    });
    return [kfield, ...btns, ffield, ...fbtns];
  }
  async saveFanart(remove) {
    const field = this.rows.find(r => r.fd.id === "fanartKey");
    const key = remove ? "" : String(field.input.value || "").trim();
    if (!remove && !key) return this.vaStatus("type the key first", "err");
    this.vaStatus(remove ? "removing…" : "checking the key with fanart.tv…", "busy");
    const r = await Apps.call("/apps/fanart/key", { key });
    if (r.server === false) return this.vaStatus("the helper isn't running — start the app with “Start Media Center”", "err");
    if (!r.ok) return this.vaStatus(r.error || "couldn't save that", "err");
    ArtistArt.forget(); // artists looked up without the key get another try
    this.vals.fanartKey = ""; field.input.value = "";
    field.input.placeholder = r.set ? "saved — type a new one to replace it" : "your personal api key from fanart.tv";
    this.vaStatus(!r.set ? "key removed" : r.checked ? "saved — the key works" : "saved (fanart.tv didn't answer, so it wasn't checked)", r.set ? "ok" : "");
  }
  // one column, read top to bottom: your key (+ premium sign-in), where youtube opens, your account
  buildYouTube() {
    const form = el("div", "form stack"); this.body.append(form);
    const sec = t => form.append(el("div", "set-sec t", esc(t)));
    sec("youtube key");
    if (this.vals.ytKey === undefined) this.vals.ytKey = Prefs.get("ytKey") || "";
    const kfield = this.makeField({ id: "ytKey", label: "api key", ph: "your key from google's developer console", secret: true }, form);
    const kbtns = this.makeButtons(form, [{ id: "saveYtKey", label: "save" }, { id: "ytSignin", label: "premium" }]);
    this.statusEl = el("div", "status t"); form.append(this.statusEl);
    form.append(el("div", "set-note t", "premium: sign in once on youtube's own page so videos play without ads."));
    this.setStatus(Tube.key ? "a key is saved" : "no key yet — youtube opens in vacuumtube", Tube.key ? "ok" : "");

    sec("menu");
    const orow = el("div", "opt-row t", `<div class="lab">youtube opens in</div><div class="btn"></div>`);
    orow.opt = {
      label: "youtube opens in", values: () => [["native", "the media center"], ["vacuumtube", NATIVE ? "the youtube app" : "vacuumtube"]],
      get: () => Prefs.get("ytOpen") === "vacuumtube" ? "vacuumtube" : "native", set: v => Prefs.set("ytOpen", v),
    };
    form.append(orow); this.showValue(orow);

    sec("your account");
    this.vals.ytCid = this.vals.ytCid || ""; this.vals.ytSecret = this.vals.ytSecret || "";
    const fid = this.makeField({ id: "ytCid", label: "sign-in client id", ph: "…apps.googleusercontent.com" }, form);
    const fsec = this.makeField({ id: "ytSecret", label: "client secret", ph: "from the same page in google's console", secret: true }, form);
    // one button for signing in or out, whichever applies
    const acct = signed => signed ? { id: "ytOut", label: "sign out" } : { id: "ytCode", label: "sign in" };
    const abtns = this.makeButtons(form, [{ id: "saveYtClient", label: "save" }, acct(Tube.signedIn)]);
    this.vaStatusEl = el("div", "status t"); form.append(this.vaStatusEl);
    form.append(el("div", "set-note t", "for your subscriptions, channels, playlists and liked videos. the readme says where to get the client id and secret."));
    this.vaStatus("checking…");
    Tube.account().then(st => {
      if (!this.el || !this.vaStatusEl || SETTINGS_TABS[this.tab].build !== "youtube") return;
      if (st.server === false) return this.vaStatus("the helper isn't running — start the app with “Start Media Center”", "err");
      if (st.client && !fid.input.value) fid.input.placeholder = "saved — type a new one to replace it";
      if (st.client && !fsec.input.value) fsec.input.placeholder = "saved";
      const b = abtns[1]; b.b = acct(!!st.signed_in); b.textContent = b.b.label;
      this.vaStatus(st.signed_in ? "signed in — your subscriptions are in youtube" : st.client ? "ready — choose “sign in”" : "not set up yet", st.signed_in ? "ok" : "");
    });
    return [kfield, ...kbtns, orow, fid, fsec, ...abtns];
  }
  async saveYtClient() {
    const id = String(this.rows.find(r => r.fd.id === "ytCid").input.value || "").trim();
    const secret = String(this.rows.find(r => r.fd.id === "ytSecret").input.value || "").trim();
    if (!id) return this.vaStatus("type the client id first", "err");
    const r = await Apps.call("/apps/youtube/client", { id, secret });
    if (r.server === false) return this.vaStatus("the helper isn't running — start the app with “Start Media Center”", "err");
    if (!r.ok) return this.vaStatus(r.error || "couldn't save that", "err");
    this.vals.ytCid = ""; this.vals.ytSecret = "";
    this.vaStatus("saved — now choose “sign in”", "ok");
  }
  async ytSignOut() {
    const r = await Apps.call("/apps/youtube/signout", {});
    if (r.server === false) return this.vaStatus("the helper isn't running", "err");
    Tube.signedIn = false; Tube.access = null; Tube.feedCache = null;
    this.refresh("ytCode"); // the button becomes "sign in"
    toast("signed out of your youtube account");
  }
  saveYtKey() {
    const key = String(this.rows[0].input.value || "").trim();
    Prefs.set("ytKey", key);
    if (!key) return this.setStatus("key removed — youtube opens in vacuumtube");
    this.setStatus("checking the key…", "busy");
    Tube.trending().then(l => this.setStatus(`saved — the key works (${l.length} trending videos)`, "ok"), e => this.setStatus("saved, but " + lower(e.message), "err"));
  }
  async ytSignin() {
    const r = await Apps.call("/apps/youtube/signin", {});
    if (r.server === false) return this.setStatus("the helper isn't running — start the app with “Start Media Center”", "err");
    if (!r.ok) return this.setStatus(r.error || "couldn't open youtube's sign-in", "err");
    this.setStatus("youtube's sign-in opened in a new window — sign in there, then close that window (alt+f4)", "ok");
  }
  // one column: vacuumtube (youtube's fallback), then the voice assistant
  buildApps() {
    const form = el("div", "form stack"); this.body.append(form);
    const sec = t => form.append(el("div", "set-sec t", esc(t)));
    if (NATIVE) return this.buildAppsShield(form, sec);
    sec("vacuumtube (youtube fallback)");
    this.vals.ytPath = this.vals.ytPath || "";
    const field = this.makeField({ id: "ytPath", label: "vacuumtube.exe location", ph: "e.g. C:\\Users\\you\\AppData\\Local\\Programs\\VacuumTube\\VacuumTube.exe" }, form);
    const btns = this.makeButtons(form, [{ id: "saveYt", label: "save" }, { id: "testYt", label: "open it" }]);
    this.statusEl = el("div", "status t"); form.append(this.statusEl);
    form.append(el("div", "set-note t", "the separate youtube app, full screen. used when settings → youtube says so, or a video can't play here."));
    this.setStatus("checking…");
    Apps.status().then(st => {
      if (!this.el || !this.statusEl || SETTINGS_TABS[this.tab].build !== "apps") return;
      if (st.server === false) return this.setStatus("the helper isn't running — start the app with “Start Media Center”", "err");
      if (st.path && !this.vals.ytPath) { this.vals.ytPath = st.path; field.input.value = st.path; }
      this.setStatus(st.ready ? "ready" : "not set up yet", st.ready ? "ok" : "");
    });

    sec("voice assistant");
    this.vals.vaPath = this.vals.vaPath || "";
    const vfield = this.makeField({ id: "vaPath", label: "assistant folder", ph: "the folder with app.py, e.g. C:\\assistant" }, form);
    const vbtns = this.makeButtons(form, [{ id: "saveVa", label: "save" }, { id: "startVa", label: "start it now" }, { id: "vaHelp", label: "what can i say?" }]);
    // "what can I say?" only shows once the assistant folder is set and has its list of commands
    const help = vbtns.pop(); help.style.display = "none";
    this.vaStatusEl = el("div", "status t"); form.append(this.vaStatusEl);
    form.append(el("div", "set-note t", "“Start Media Center” starts it and its mic listener too, in minimized windows."));
    this.vaStatus("checking…");
    Apps.call("/apps/assistant").then(st => {
      if (!this.el || !this.vaStatusEl || SETTINGS_TABS[this.tab].build !== "apps") return;
      if (st.server === false) return this.vaStatus("the helper isn't running — start the app with “Start Media Center”", "err");
      if (st.path && !this.vals.vaPath) { this.vals.vaPath = st.path; vfield.input.value = st.path; }
      this.vaStatus(st.running ? "running" : st.ready ? "set up — not running right now" : "not set up yet", st.running ? "ok" : "");
      if (st.ready) this.showVoiceHelpButton(help, vbtns[vbtns.length - 1]);
    });
    return [field, ...btns, vfield, ...vbtns];
  }
  async showVoiceHelpButton(help, after) {
    const r = await Apps.call("/apps/assistant/commands");
    if (!r.ready || !this.el || SETTINGS_TABS[this.tab].build !== "apps" || this.items.includes(help)) return;
    const i = this.items.indexOf(after);
    if (i < 0) return;
    help.style.display = "";
    this.items.splice(i + 1, 0, help);
    if (this.zone === "body" && this.f > i) this.f++; // (what's picked stays picked)
    this.paint();
  }
  // the Shield: youtube hands over to the YouTube app; the voice assistant (on the PC with the mic)
  // sends its commands to this Shield instead of to the PC
  buildAppsShield(form, sec) {
    sec("youtube app");
    const btns = this.makeButtons(form, [{ id: "testYt", label: "open it" }]);
    form.append(el("div", "set-note t", "the shield's youtube app (or smarttube). used when settings → youtube says so."));
    sec("voice assistant");
    const addr = (() => { try { return NATIVE.helperAddress(); } catch { return ""; } })();
    form.append(el("div", "set-note t", addr
      ? `in the voice assistant's settings, set ZUNE_URL to  ${esc(addr)}  — it then sends its commands to this shield.`
      : "this shield isn't on the home network right now."));
    return btns;
  }
  vaStatus(text, kind = "") {
    const e = this.vaStatusEl;
    if (!e) return;
    e.className = "status t" + (kind ? " " + kind : "");
    e.textContent = text;
  }
  async saveAssistant() {
    this.vaStatus("saving…");
    const field = this.rows.find(r => r.fd.id === "vaPath");
    const r = await Apps.call("/apps/assistant/path", { path: field.input.value });
    if (r.server === false) return this.vaStatus("the helper isn't running — start the app with “Start Media Center”", "err");
    if (!r.ok) return this.vaStatus(r.error || "couldn't save that", "err");
    this.vals.vaPath = r.path; field.input.value = r.path;
    this.vaStatus("saved — it will start with the media center", "ok");
  }
  async startAssistant() {
    this.vaStatus("starting… (the listener can take a minute to load)", "busy");
    const r = await Apps.call("/apps/assistant/start", {});
    if (r.server === false) return this.vaStatus("the helper isn't running — start the app with “Start Media Center”", "err");
    if (!r.ok) return this.vaStatus(r.error || "couldn't start it", "err");
    this.vaStatus(r.started && r.started.length ? "started" : "it's already running", "ok");
  }

  // ----- focus -----
  paint() {
    this.tabEls.forEach((e, i) => e.classList.toggle("on", i === this.tab));
    this.root.classList.toggle("head", this.zone === "head");
    (this.items || []).forEach((e, i) => e.classList.toggle("focus", this.zone === "body" && i === this.f));
    this.scrollBody();
  }
  // keep the picked row in view: the page glides up when it would fall below the screen
  scrollBody() {
    const it = this.zone === "body" && this.items && this.items[this.f];
    let sc = 0;
    if (it) {
      let top = 0;
      for (let e = it; e && e !== this.body; e = e.offsetParent) top += e.offsetTop;
      const bottom = top + it.offsetHeight, view = 1040, start = 330;
      sc = this.bodyScroll || 0;
      if (bottom + 40 > sc + view) sc = bottom + 40 - view;
      if (top - 20 < sc + start) sc = top - 20 - start;
      sc = Math.max(0, sc);
    }
    if (sc === (this.bodyScroll || 0)) return;
    this.bodyScroll = sc;
    this.body.style.translate = `0 ${-sc}px`;
    this.body.querySelectorAll(".set-note.side").forEach(n => { n.style.translate = `0 ${sc}px`; }); // the side hint stays put
  }
  async switchTab(dir) {
    const n = SETTINGS_TABS.length, next = this.tab + dir;
    if (next < 0 || next >= n || this.lock) return;
    this.lock = true;
    this.titleEl.style.translate = `${-next * TITLE_PAN}px 0px`; // the title starts drifting along with the content
    const oldEls = [...this.body.children];
    await Promise.race([slideOut(oldEls, dir, { dist: 160, dur: 170, stagger: 0 }), wait(250)]);
    if (!this.el) return;
    this.tab = next; this.f = 0;
    this.buildTab();
    slideIn([...this.body.children], dir, { dist: 280, stagger: 34 });
    if (this.tab === 0 && Emby.connected) this.loadLibs();
    this.lock = false;
  }
  refresh(focusId) {
    this.buildTab();
    if (focusId) { const i = this.items.findIndex(e => e.b && e.b.id === focusId); if (i >= 0) { this.f = i; this.paint(); } }
    if (this.tab === 0 && Emby.connected) this.loadLibs();
  }
  showStatus() {
    const e = this.statusEl, s = Emby.state;
    if (!e) return;
    e.className = "status t";
    if (this.msg) { e.textContent = this.msg.text; e.classList.add(this.msg.kind); }
    else if (Emby.connected) { e.innerHTML = `connected to <b>${esc(s.serverName)}</b> as <b>${esc(s.userName)}</b>`; e.classList.add("ok"); }
    else e.textContent = "not connected";
  }
  async loadLibs() {
    const box = this.libsEl;
    if (!box) return;
    box.innerHTML = `<div class="lab">your libraries</div>`;
    try {
      const libs = await Emby.libraries();
      if (!this.el || box !== this.libsEl) return;
      const els = libs.map(l => el("div", "lib", `${esc(l.name)}${LIB_TYPE[l.type] && LIB_TYPE[l.type] !== l.name.toLowerCase() ? `<span>${LIB_TYPE[l.type]}</span>` : ""}`));
      if (!els.length) els.push(el("div", "lib none", "none found"));
      box.append(...els);
      turnIn(els, 1, { stagger: 50 });
    } catch (err) {
      if (box === this.libsEl) box.append(el("div", "lib none", "couldn't load libraries — " + esc(err.message)));
    }
  }

  // ----- keys -----
  key(k) {
    if (this.working) return k !== "back";
    if (this.zone === "head") {
      if (k === "left" || k === "right") { this.switchTab(k === "left" ? -1 : 1); return true; }
      if (k === "down" || k === "ok") { this.zone = "body"; this.f = 0; this.paint(); return true; }
      return k === "up";
    }
    const it = this.items[this.f];
    if (it && it.chId && (k === "left" || k === "right" || k === "ok")) { this.cycleChannel(it, k === "left" ? -1 : 1); return true; }
    if (!it && (k === "left" || k === "right" || k === "ok" || k === "down")) return true; // (a tab still loading)
    if (it && it.menuId) { // hub menu rows
      if (k === "left" || k === "right") { this.moveMenu(it.menuId, k === "left" ? -1 : 1); return true; }
      if (k === "ok") { this.toggleMenu(it.menuId); return true; }
    }
    if (k === "up" && this.f === 0) { this.zone = "head"; this.paint(); return true; }
    if (k === "up" || k === "down") { this.f = clamp(this.f + (k === "up" ? -1 : 1), 0, this.items.length - 1); this.paint(); return true; }
    if (k === "left" || k === "right") {
      const d = k === "left" ? -1 : 1;
      if (it.opt) this.cycle(it, d);
      else if (it.b) { const j = this.f + d; if (this.items[j] && this.items[j].b) { this.f = j; this.paint(); } } // between the buttons
      return true;
    }
    if (k === "ok") {
      if (it.opt) this.cycle(it, 1);
      else if (it.input) this.edit(it);
      else if (it.b.id === "connect") this.connect();
      else if (it.b.id === "signout") this.signOut();
      else if (it.b.id === "saveRadio") this.saveRadio();
      else if (it.b.id === "saveFanart") this.saveFanart(false);
      else if (it.b.id === "clearFanart") this.saveFanart(true);
      else if (it.b.id === "saveYt") this.saveYouTube();
      else if (it.b.id === "saveYtKey") this.saveYtKey();
      else if (it.b.id === "saveYtClient") this.saveYtClient();
      else if (it.b.id === "ytCode") go(new YtCodePage());
      else if (it.b.id === "ytOut") this.ytSignOut();
      else if (it.b.id === "ytSignin") this.ytSignin();
      else if (it.b.id === "ytOpen") { Prefs.set("ytOpen", Prefs.get("ytOpen") === "vacuumtube" ? "native" : "vacuumtube"); this.refresh("ytOpen"); }
      else if (it.b.id === "testYt") Apps.launch();
      else if (it.b.id === "saveVa") this.saveAssistant();
      else if (it.b.id === "startVa") this.startAssistant();
      else if (it.b.id === "vaHelp") showVoiceHelp();
      return true;
    }
    return false;
  }
  // typing into a field: Enter keeps it, Esc undoes it, up/down keep it and move on
  edit(row) {
    row.classList.add("editing");
    row.input.focus();
    const n = row.input.value.length; row.input.setSelectionRange(n, n);
  }
  inputKey(key) {
    const row = (this.rows || []).find(r => r.input === document.activeElement);
    if (!row) return;
    if (key === "Escape") row.input.value = this.vals[row.fd.id];
    else this.vals[row.fd.id] = row.input.value;
    row.input.blur(); row.classList.remove("editing");
    if (key === "ArrowUp") this.f = Math.max(0, this.f - 1);
    else if (key === "ArrowDown" || key === "Tab" || key === "Enter") this.f = Math.min(this.items.length - 1, this.f + 1);
    this.paint();
  }
  saveRadio() {
    const key = String(this.rows[0].input.value || "").trim();
    Prefs.set("radioKey", key);
    this.setStatus(key ? "saved" : "listen key removed", key ? "ok" : "");
  }
  async saveYouTube() {
    this.setStatus("saving…");
    const r = await Apps.setPath(this.rows[0].input.value);
    if (r.server === false) return this.setStatus("the helper isn't running — start the app with “Start Media Center”", "err");
    if (!r.ok) return this.setStatus(r.error || "couldn't save that", "err");
    this.vals.ytPath = r.path; this.rows[0].input.value = r.path;
    this.setStatus("saved — youtube is ready", "ok");
  }
  async connect() {
    this.rows.forEach(r => { this.vals[r.fd.id] = r.input.value; }); // read exactly what's on screen
    this.working = true;
    this.msg = { text: "connecting…", kind: "busy" }; this.showStatus();
    try {
      await Emby.connect(this.vals.server, this.vals.user, this.vals.pw);
      Remote.start(); // take commands from Emby from now on
      this.vals.pw = ""; this.vals.server = Emby.state.server; this.msg = null;
      quick.key = null; quick.rows = null; // quickplay reloads from the server
      this.refresh("signout");
    } catch (err) {
      this.msg = { text: err.message, kind: "err" }; this.showStatus();
    }
    this.working = false;
  }
  async signOut() {
    this.working = true;
    Live.stop();
    Remote.stop();
    await Emby.signOut();
    quick.key = null; quick.rows = null;
    this.working = false; this.msg = { text: "signed out", kind: "busy" };
    this.refresh("connect");
  }
}

/* ============ lyrics (from Emby, like the old Zune hub) ============
   The lyrics button on the music player (or "show lyrics" by voice) turns them on: the cover tucks up
   to the left and the words scroll by on the right, the current line lit. Timed (.lrc) lyrics follow
   the song exactly; plain ones move along evenly. Stays on for the next songs until turned off. */
const Lyrics = {
  on: false, cache: new Map(), // song id -> lines ([] = none)
  async load(t) {
    if (!t || t.live || !t.emby || !Emby.connected) return [];
    if (this.cache.has(t.id)) return this.cache.get(t.id);
    let lines = [];
    try {
      const r = await Emby.lyrics(t.id);
      if (r && r.lines) lines = r.lines;
      else if (r && r.text) lines = this.parse(r.text);
      else if (r && r.files && location.protocol !== "file:") {
        for (const f of r.files) { // Emby keeps the music on this PC: the helper reads the .lrc file
          const res = await fetch("/lyrics?path=" + encodeURIComponent(f), { headers: { "X-Media-Center": "1" } }).then(x => x.json()).catch(() => null);
          if (res && res.text) { lines = this.parse(res.text); if (lines.length) break; }
        }
      }
    } catch { lines = []; }
    this.cache.set(t.id, lines);
    return lines;
  },
  // .lrc ("[01:23.45] words"), .srt / .vtt ("00:01:23,450 --> …" blocks) or plain text → [{ text, start }]
  parse(text) {
    const lines = [];
    const sec = (h, m, s) => (+h || 0) * 3600 + (+m) * 60 + parseFloat(String(s).replace(",", "."));
    if (/-->/.test(text)) {
      for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
        const rows = block.split("\n").map(r => r.trim()).filter(Boolean);
        const ti = rows.findIndex(r => r.includes("-->"));
        if (ti < 0) continue;
        const m = rows[ti].match(/(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)\s*-->/);
        const words = rows.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").trim();
        if (m && words) lines.push({ text: words, start: sec(m[1], m[2], m[3]) });
      }
    } else {
      for (const raw of text.replace(/\r/g, "").split("\n")) {
        const row = raw.trim();
        if (!row || /^\[[a-z]+:[^\]]*\]$/i.test(row)) continue; // [ar:artist] [ti:title] … tags
        const times = [...row.matchAll(/\[(\d+):(\d+(?:[.,]\d+)?)\]/g)].map(m => sec(0, m[1], m[2]));
        const words = row.replace(/\[\d+:\d+(?:[.,]\d+)?\]/g, "").replace(/<\d+:\d+(?:[.,]\d+)?>/g, "").trim();
        if (!words) continue;
        if (times.length) times.forEach(start => lines.push({ text: words, start }));
        else lines.push({ text: words, start: null });
      }
    }
    if (lines.some(l => l.start != null)) lines.sort((a, b) => (a.start ?? 1e12) - (b.start ?? 1e12));
    return lines;
  },
  // which line is being sung at this point of the song
  at(lines, pos, dur) {
    if (!lines.length) return -1;
    if (lines.some(l => l.start != null)) {
      let a = -1;
      for (let i = 0; i < lines.length; i++) { const s = lines[i].start; if (s == null) continue; if (s <= pos + 0.05) a = i; else break; }
      return a;
    }
    return dur > 0 ? clamp(Math.floor(pos / dur * lines.length), 0, lines.length - 1) : 0;
  },
  async set(on) {
    if (!on) { this.on = false; this.refresh(); return { ok: true, enabled: false }; }
    const t = Player.track;
    if (!t) return { error: "Nothing is playing." };
    if (t.live) return { error: "Lyrics are only available for music." };
    const lines = await this.load(t);
    if (!lines.length) return { error: "No lyrics for this track." };
    this.on = true;
    if (!(top() instanceof NowPlaying)) await showPlayer();
    this.refresh();
    return { ok: true, enabled: true, lineCount: lines.length, synced: lines.some(l => l.start != null) };
  },
  refresh() { const p = top(); if (p instanceof NowPlaying && p.el) p.lyrics(); },
};

/* ============ now playing ============ */
const NP_BUTTONS = ["prev", "play", "next", "stop", "lyrics"];
const ICON = {
  prev: `<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>`,
  next: `<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>`,
  lyrics: `<svg viewBox="0 0 24 24"><path d="M3 5h13v2H3zm0 4h13v2H3zm0 4h8v2H3zm15-8h3v2h-1v8.5a2.5 2.5 0 1 1-2-2.45z"/></svg>`,
  shuffle: `<svg viewBox="0 0 24 24"><path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2.1H20v-5.5l-2 2z"/></svg>`,
};

class NowPlaying extends Page {
  bg() { return { opacity: 0 }; }
  // Zune HD now playing: back circle, ARTIST / ALBUM in caps, big cover, then
  // the time bar, the song title and round buttons — all over the artist's photo.
  render() {
    // art-hide / art-center: what the cover does when the info fades away (settings → playback)
    const r = el("div", "np art-" + Prefs.get("npArt"));
    r.innerHTML = `
      <div class="np-bg"></div><div class="np-shade"></div>
      <div class="np-head"><div class="np-artist t"></div><div class="np-album t"></div></div>
      <img class="np-art flip" alt="">
      <div class="np-lyr"><div class="np-lyr-in"></div></div>
      <div class="np-side">
        <div class="np-times t"><span class="cur"></span><span class="np-state">paused</span><span class="rem"></span></div>
        <div class="np-bar t"><i></i></div>
        <div class="np-title t"></div>
        <div class="np-next t"></div>
        <div class="np-ctl t">${NP_BUTTONS.map(b => `<div class="b" data-b="${b}">${ICON[b] || ""}</div>`).join("")}</div>
      </div>`;
    this.bgArtist = null;
    this.f = NP_BUTTONS.indexOf("play"); // ← → pick a button, Enter presses it
    return r;
  }
  q(s) { return this.el.querySelector(s); }
  mounted() { this.fill(); this.state(); this.wake(); }
  // show the lyrics for the current song (if they're on and it has some), docked beside the cover
  async lyrics() {
    const t = Player.track, box = this.q(".np-lyr-in");
    const lines = Lyrics.on && t && !t.live ? await Lyrics.load(t) : [];
    if (!this.el || Player.track !== t) return;
    this.lyr = lines.length ? lines : null;
    if (this.lyr && box.dataset.id !== String(t.id)) {
      box.innerHTML = lines.map(l => `<p>${esc(l.text)}</p>`).join("");
      box.dataset.id = t.id; this.lyrIdx = null;
      box.style.transition = "none"; box.style.transform = "translateY(300px)"; void box.offsetWidth; box.style.transition = "";
    }
    this.el.classList.toggle("lyr", !!this.lyr);
    this.q('[data-b="lyrics"]').classList.toggle("on", Lyrics.on);
    this.syncLyrics();
  }
  syncLyrics() {
    if (!this.lyr || !this.el) return;
    const i = Lyrics.at(this.lyr, Player.pos, Player.dur);
    if (i === this.lyrIdx) return;
    this.lyrIdx = i;
    const box = this.q(".np-lyr-in"), rows = box.children;
    for (let j = 0; j < rows.length; j++) { rows[j].classList.toggle("now", j === i); rows[j].classList.toggle("past", j < i); }
    // glide so the current line sits a third of the way down the panel
    const row = rows[Math.max(0, i)];
    if (row) box.style.transform = `translateY(${Math.round(260 - row.offsetTop - row.offsetHeight / 2)}px)`;
  }
  unmount() { clearTimeout(this.idleTimer); super.unmount(); }
  // After a few seconds without a key press the info and controls fade away, leaving the artist's
  // backdrop (and, if set, the cover moved to the middle). Any key brings them back.
  wake() {
    if (!this.el) return;
    this.el.classList.remove("idle");
    clearTimeout(this.idleTimer);
    const secs = Prefs.get("npHide");
    if (secs > 0) this.idleTimer = setTimeout(() => this.el && this.el.classList.add("idle"), secs * 1000);
  }
  fill() {
    const t = Player.track; if (!t) return;
    const art = this.q(".np-art");
    setCover(art, t.album);
    this.q(".np-artist").textContent = t.artist.name;
    this.q(".np-album").textContent = t.album.title;
    this.q(".np-title").textContent = t.title;
    const nx = Player.peek();
    this.el.classList.toggle("live", !!t.live); // radio: no time bar, blurred cover behind
    this.q(".np-next").innerHTML = !nx ? "" : t.live
      ? `next station <b>${esc(nx.station.title)}</b> · ${esc(nx.station.net.name)}`
      : `next <b>${esc(nx.title)}</b> · ${esc(nx.artist.name)}`;
    this.setBg(t); this.tick();
    if (Lyrics.on || this.lyr) this.lyrics();
  }
  setBg(t) {
    const src = artistPhoto(t.artist); // (radio: the artist's photos take turns, see ArtistArt)
    if (this.bgArtist === t.artist && this.bgSrc === src) return;
    this.bgArtist = t.artist; this.bgSrc = src;
    const wrap = this.q(".np-bg"), img = el("img");
    img.alt = ""; img.style.opacity = 0;
    img.classList.toggle("soft", softArtist(t)); // radio with only the song's cover: blurred behind
    img.onerror = () => { img.onerror = null; img.src = Art.photo(t.artist.name, t.artist.hue); };
    img.src = src;
    const olds = [...wrap.children];
    wrap.append(img);
    void img.offsetWidth; // commit the starting opacity so the fade runs
    img.style.opacity = 1;
    setTimeout(() => olds.forEach(o => o.remove()), 1500);
  }
  tick() {
    const t = Player.track; if (!t) return;
    const d = Player.dur || 1;
    this.q(".np-bar i").style.width = Math.min(100, Player.pos / d * 100) + "%";
    this.q(".cur").textContent = fmt(Player.pos);
    this.q(".rem").textContent = "-" + fmt(Math.max(0, d - Player.pos));
    this.syncLyrics();
  }
  state() {
    this.el.classList.toggle("paused", !Player.playing);
    this.q('[data-b="play"]').innerHTML = Player.playing ? ICON.pause : ICON.play;
    this.paint();
  }
  paint() { this.el.querySelectorAll(".np-ctl .b").forEach((e, i) => e.classList.toggle("focus", i === this.f)); }
  press(b) {
    this.hit(b);
    if (b === "prev") Player.prev();
    else if (b === "next") Player.next();
    else if (b === "play") Player.toggle();
    else if (b === "stop") Player.stop();
    else if (b === "lyrics") {
      if (Lyrics.on) return Lyrics.set(false);
      if (Player.track && Player.track.live) return toast("lyrics aren't available for radio");
      toast("looking for lyrics…");
      Lyrics.set(true).then(r => { if (r.error) toast(lower(r.error)); });
    }
  }
  hit(b) {
    const e = this.q(`[data-b="${b}"]`);
    e.classList.add("hit"); setTimeout(() => e.classList.remove("hit"), 170);
  }
  async trackChange(dir) {
    const els = [".np-art", ".np-artist", ".np-album", ".np-title", ".np-next"].map(s => this.q(s));
    await Promise.race([slideOut(els, dir, { dist: 120, dur: 190, stagger: 22 }), wait(450)]);
    if (!this.el) return;
    this.fill();
    slideIn(els, dir, { dist: 220, stagger: 40 });
  }
  key(k) {
    if (k === "back") return false;
    const wasIdle = this.el.classList.contains("idle");
    this.wake();
    if (wasIdle) return true; // the first press just brings the info back
    if (k === "left" || k === "right") { this.f = clamp(this.f + (k === "left" ? -1 : 1), 0, NP_BUTTONS.length - 1); this.paint(); }
    else if (k === "ok") this.press(NP_BUTTONS[this.f]);
    return true;
  }
  player(evt, dir) {
    if (evt === "stop") { if (top() === this) back(); return; }
    if (evt === "tick") this.tick();
    else if (evt === "state") { this.state(); this.hit("play"); this.wake(); }
    else if (evt === "track") { this.state(); this.trackChange(dir || 1); this.wake(); }
  }
}

/* ============ input ============ */
const KEYS = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "ok",
  " ": "play", MediaPlayPause: "play", MediaTrackNext: "next", MediaTrackPrevious: "prev",
  Escape: "back", Backspace: "back", BrowserBack: "back", MediaStop: "stop",
};
let pending = null;
addEventListener("keydown", e => {
  Saver.poke();
  if (Saver.on || IdleSaver.on) { e.preventDefault(); Saver.hide(); return; } // the first press only wakes the screen
  // while typing in a text field, let keys type; only these finish editing
  const a = document.activeElement;
  if (a && a.tagName === "INPUT") {
    if (["Enter", "Escape", "ArrowUp", "ArrowDown", "Tab"].includes(e.key)) {
      e.preventDefault();
      if (top().inputKey) top().inputKey(e.key); else a.blur();
    }
    return;
  }
  const k = KEYS[e.key];
  if (!k) return;
  e.preventDefault();
  if (busy) { pending = k; return; } // remember one press made mid-transition
  handle(k, e.repeat);
});
function handle(k, repeat) {
  if (k === "play" && top().playKey && top().playKey()) return; // e.g. pause live tv instead of music
  if (k === "play") return Live.active ? Live.togglePause() : BgVod.active ? BgVod.togglePause() : Player.toggle();
  if ((k === "next" || k === "prev" || k === "stop") && top().mediaKey && top().mediaKey(k)) return; // e.g. live tv: change channel / stop
  if (k === "stop") return Live.active ? Live.stop() : BgVod.active ? BgVod.stop() : Player.stop();
  if (k === "next") return Player.next();
  if (k === "prev") return Player.prev();
  if (top().key(k, repeat)) return;
  if (k === "back") back();
}
function idle() {
  busy = false;
  if (pending) { const k = pending; pending = null; handle(k, false); }
}

/* ============ sleep timer (settings → playback) ============
   Stops whatever is playing after the chosen time. It isn't saved: it's for tonight only. */
const Sleep = {
  mins: 0, at: 0, timer: null,
  values() {
    const left = this.mins ? Math.max(1, Math.round((this.at - Date.now()) / 60e3)) : 0;
    return [[0, "off"], ...[15, 30, 60, 90, 120].map(n => [n, this.mins === n ? `on — ${left} min left` : `${n} minutes`])];
  },
  set(m) {
    clearTimeout(this.timer);
    this.mins = m; this.at = m ? Date.now() + m * 60e3 : 0;
    if (m) { this.timer = setTimeout(() => this.fire(), m * 60e3); toast(`sleep timer: everything stops in ${m} minutes`); }
  },
  fire() {
    this.mins = 0; this.at = 0;
    const p = top();
    if (p instanceof VodPage || p instanceof YtPage) back();
    Live.stop();
    if (Player.playing) Player.toggle();
    toast("sleep timer — good night");
  },
};

/* ============ clock ============ */
const $clock = document.getElementById("clock");
function clock() {
  const d = new Date(), style = Prefs.get("clock"); // settings → appearance → clock
  $clock.style.display = style === "off" ? "none" : "";
  $clock.textContent = `${style === "24" ? String(d.getHours()).padStart(2, "0") : d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
}
clock(); setInterval(clock, 10000);

/* ============ voice control (JSON-RPC from the voice assistant) ============
   The assistant sends the same commands it sent to the old Zune hub to http://127.0.0.1:8765/jsonrpc.
   The helper (tools/serve.py) hands each one to this page; we carry it out through the same navigation,
   keys and players the remote uses, and send the answer back. Only works when the app is opened through
   the helper ("Start Media Center"), not from the file directly. */
const norm = s => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
// best match for a spoken name: exact, then starts with, then contains (either way round)
function bestMatch(list, q, nameOf) {
  const n = norm(q);
  if (!n) return null;
  const names = list.map(x => norm(nameOf(x)));
  let i = names.findIndex(x => x === n);
  if (i < 0) i = names.findIndex(x => x.startsWith(n));
  if (i < 0) i = names.findIndex(x => x.includes(n));
  if (i < 0) i = names.findIndex(x => x.length > 2 && n.includes(x));
  return i < 0 ? null : list[i];
}
const shuffled = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
async function settled() { while (busy) await wait(50); }

// back out to the home menu (skipping the screens in between), then optionally open a section from it
async function goHome() {
  await settled();
  const h = stack[0];
  if (h && h.sec === 1) h.setSec(0);
  if (stack.length <= 1) return;
  stack.splice(1, stack.length - 2); // keep home and the current screen, so Back animates straight home
  await back();
}
async function openSection(id) {
  await goHome();
  await settled();
  const h = top();
  if (h.items && h.items.includes(id)) { h.mid = id; h.paint(); } // so the menu word grows into the title
  go(sectionPage(id));
}
// full screen for whatever is playing
async function showPlayer() {
  await settled();
  const p = top();
  if (BgVod.active) { go(BgVod.page); return true; }
  if (Live.active) { if (!(p instanceof LivePage)) go(new LivePage(Live.guide, Live.i)); return true; }
  if (Player.track) { if (!(p instanceof NowPlaying)) go(new NowPlaying()); return true; }
  return false;
}
const WINDOWS = {
  home: "home", mainmenu: "home", menu: "home", hub: "home",
  movies: "movies", movie: "movies", films: "movies",
  tv: "tv shows", tvshows: "tv shows", shows: "tv shows", series: "tv shows",
  music: "music", songs: "music",
  tvguide: "tv guide", guide: "tv guide", epg: "tv guide",
  livetv: "live", live: "live", tvchannels: "live", channels: "live",
  radio: "radio", photos: "pictures", pictures: "pictures", pics: "pictures",
  homevideos: "home videos", homevideo: "home videos", homemovies: "home videos", videos: "home videos",
  recordings: "recordings", recorded: "recordings", dvr: "recordings", recordedtv: "recordings",
  settings: "settings", setup: "settings", youtube: "youtube",
  nowplaying: "player", fullscreen: "player", player: "player",
  voicecommands: "voice", whatcanisay: "voice", voicehelp: "voice", commands: "voice",
};

// channels for voice tuning ("channel hallmark")
let voiceChannels = null;
async function channelList() {
  if (!Emby.connected) throw new Error("live tv needs the app signed in to emby");
  if (!voiceChannels) voiceChannels = await Emby.channels();
  return voiceChannels;
}
async function tuneChannel(q) {
  const chans = await channelList();
  const ch = chans.find(c => c.number && norm(c.number) === norm(q)) || bestMatch(chans, q, c => c.name);
  if (!ch) throw new Error(`channel ${q} not found`);
  const g = new GuidePage(); // used as the channel list / listings holder for the player
  g.channels = channelsWith(chans, ch);
  await settled();
  go(new LivePage(g, g.channels.indexOf(ch)), { replace: top() instanceof LivePage });
  return ch;
}

// what's playing, in the shape the assistant expects
function nowPlayingItem() {
  if (Live.active && Live.ch) {
    const ch = Live.ch, now = Date.now();
    let p = Live.guide && Live.guide.progs.has(ch.id) ? Live.guide.progAt(ch, now) : null;
    if (p && !(p.start <= now && p.end > now)) p = null;
    return {
      playing: !Live.video.paused, mediaActive: true, mode: "livetv",
      title: p ? p.title : ch.name, show: p ? p.title : "", episode: p ? p.ep : "", plot: p ? p.overview : "",
      channel: { name: ch.name, number: ch.number },
      program: p ? { show: p.title, episode: p.ep, title: p.title } : {},
    };
  }
  const t = Player.track;
  if (t) {
    return {
      playing: Player.playing, mediaActive: true, mode: t.live ? "radio" : "Audio",
      title: t.title, artist: t.artist.name, album: t.live ? t.station.title : t.album.title,
      show: "", episode: "", plot: "",
      channel: t.live ? { name: t.station.title, number: "" } : {},
      ...(t.live ? { station: t.station.title, network: t.station.net.name } : {}),
    };
  }
  return { playing: false, mediaActive: false, mode: "none", title: "", channel: {}, program: {} };
}

async function playMusicBy({ artist, genre, shuffle = true }) {
  let label, songs;
  if (!Emby.connected) { // sample library
    if (artist) { const a = bestMatch(LIB.artists, artist, x => x.name); if (a) { label = a.name; songs = a.albums.flatMap(al => al.tracks); } }
    else { const g = bestMatch(LIB.genres, genre, x => x.name); if (g) { label = g.name; songs = g.albums.flatMap(al => al.tracks); } }
  } else if (artist) {
    const a = bestMatch(await Emby.findArtists(artist), artist, x => x.name);
    if (a) { label = a.name; songs = await Emby.artistSongs(a.id); }
  } else {
    const g = bestMatch(await Emby.findMusicGenres(genre), genre, x => x.name);
    if (g) { label = g.name; songs = await Emby.genreSongs(g.id); }
    else { songs = await Emby.searchSongs(genre); label = genre; } // e.g. "christmas" in song titles
  }
  if (!songs || !songs.length) return { error: `couldn't find any ${artist ? "music by " + artist : genre + " music"}` };
  Player.play(shuffle ? shuffled(songs) : songs, 0);
  await settled();
  if (!(top() instanceof NowPlaying)) go(new NowPlaying());
  return { label, count: songs.length };
}

async function playRadioStation({ query, station, network }) {
  query = query || station || "";
  if (!Radio.key) return { error: "add your radio listen key in settings, radio" };
  let nets = RADIO_NETWORKS;
  if (network) {
    const n = bestMatch(RADIO_NETWORKS, network, x => x.name) || RADIO_NETWORKS.find(x => norm(network).includes(norm(x.id)));
    if (n) nets = [n];
  }
  const lists = await Promise.all(nets.map(n => Radio.channels(n).catch(() => [])));
  for (const list of lists) {
    const st = bestMatch(list, query, x => x.title);
    if (!st) continue;
    Player.play(list.map(s => Radio.track(s)), list.indexOf(st));
    await settled();
    if (!(top() instanceof NowPlaying)) go(new NowPlaying());
    return { station: st.title, network: st.net.name };
  }
  return { error: `couldn't find a radio station called ${query}` };
}

// Input.ExecuteAction: remote-style actions, run through the same key handling as the remote
async function runAction(action) {
  const a = norm(action), p = top();
  await settled();
  const key = { up: "up", down: "down", left: "left", right: "right", select: "ok", enter: "ok", ok: "ok", back: "back",
    previousmenu: "back", close: "back", playpause: "play", pause: "play", play: "play", stop: "stop" }[a];
  if (key) { handle(key, false); return true; }
  if (a === "pageup" || a === "pagedown") { for (let i = 0; i < 5; i++) handle(a === "pageup" ? "up" : "down", true); return true; }
  if (a === "fullscreen") return showPlayer();
  if (a === "mute") { Volume.muted = !Volume.muted; Volume.apply(); return true; }
  if (["fastforward", "stepforward", "rewind", "stepback"].includes(a)) {
    const fwd = a === "fastforward" || a === "stepforward";
    if (p instanceof LivePage) { p.skip(fwd ? 1 : -1); return true; }
    if (Player.track) { fwd ? Player.next() : Player.prev(); return true; }
    return false;
  }
  if (a === "channelup" || a === "channeldown") {
    if (p instanceof LivePage) { p.changeChannel(a === "channelup" ? 1 : -1); return true; }
    return false;
  }
  if (a === "info" || a === "osd") { if (p instanceof LivePage) { p.controls(); p.press("info"); } return true; }
  if (a === "closeinfo") { if (p instanceof LivePage) p.setMode("hidden"); return true; }
  if (a === "contextmenu") return true;
  const ccWant = ["showsubtitles", "subtitles", "captions", "closedcaptions", "cc", "togglesubtitles"].includes(a) ? "toggle"
    : ["subtitleson", "captionson", "ccon"].includes(a) ? true : ["subtitlesoff", "captionsoff", "ccoff", "hidesubtitles"].includes(a) ? false : null;
  if (ccWant !== null) { // a youtube video has its own captions setting; everywhere else, live tv's
    if (p instanceof YtPage) { if (ccWant === "toggle" || ccWant !== p.ccOn) p.press("cc"); return true; }
    CC.set(ccWant === "toggle" ? !CC.on : ccWant); toast(CC.on ? "captions on" : "captions off"); return true;
  }
  throw new Error(`unknown action ${action}`);
}

// (everyday phrasing in the voice assistant) what's on screen and playing, so "how much is left?" or
// "what's this about?" can be answered: the screen, the highlighted item, and what's playing with times
function screenContext() {
  const p = top(), out = { screen: (p && p.titleKey) || (p instanceof Home ? "home menu" : ""), volume: Volume.level, muted: Volume.muted };
  try {
    const it = p && p.list && p.list.item;
    const pick = it || (p instanceof VideoPage ? p.v : null);
    if (pick) out.highlighted = { title: pick.title || pick.name || "", type: pick.type || "", year: pick.year || "", overview: String(pick.overview || "").slice(0, 300) };
  } catch {}
  const clockAt = s => new Date(Date.now() + s * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const vp = p instanceof VodPage || p instanceof YtPage ? p : BgVod.page;
  if (vp) {
    const p = vp, v = p.v, pos = (p instanceof VodPage ? p.video.currentTime : p.pos) || 0, d = p.dur || 0;
    out.nowPlaying = { kind: p instanceof YtPage ? "youtube" : v.type === "Episode" ? "tv episode" : "movie", title: v.title, series: v.seriesName || "",
      season: v.season || "", episode: v.episode || "", overview: String(v.overview || "").slice(0, 400),
      minutesLeft: d ? Math.round((d - pos) / 60) : null, endsAt: d ? clockAt(d - pos) : null, captions: CC.on };
  } else {
    const n = nowPlayingItem();
    if (n.mediaActive) {
      out.nowPlaying = n;
      if (Live.active && Live.ch && Live.guide && Live.guide.progs.has(Live.ch.id)) {
        const pr = Live.guide.progAt(Live.ch, Date.now());
        if (pr && pr.end > Date.now()) Object.assign(out.nowPlaying, { minutesLeft: Math.round((pr.end - Date.now()) / 60e3), endsAt: clock12(pr.end), captions: CC.on });
      }
    }
  }
  if (Sleep.mins) out.sleepTimerMinutesLeft = Math.max(1, Math.round((Sleep.at - Date.now()) / 60e3));
  return out;
}

const RPC = {
  "JSONRPC.Ping": () => "pong",
  // everyday phrasing: what it heard shows at the bottom of the screen; the sleep timer by voice; what's on screen
  "GUI.ShowNotification": p => { toast(String(p.message || p.title || "").slice(0, 160)); return { shown: true }; },
  "App.SleepTimer": p => { Sleep.set(clamp(Math.round(Number(p.minutes) || 0), 0, 240)); return { minutes: Sleep.mins }; },
  "App.GetContext": () => screenContext(),
  "GUI.ActivateWindow": async p => {
    const name = p.window || p.windowname || p.section || p.view || "";
    const w = WINDOWS[norm(name)];
    if (!w) throw new Error(`unknown window ${name}`);
    if (w === "home") await goHome();
    else if (w === "youtube") { if (Tube.native) await openSection("youtube"); else await Apps.launch(); }
    else if (w === "player") { if (!(await showPlayer())) throw new Error("nothing is playing"); }
    else if (w === "live") { if (Live.active) await showPlayer(); else await openSection("tv guide"); }
    else if (w === "voice") await showVoiceHelp(); // "what can I say"
    else await openSection(w);
    return { window: w };
  },
  "Input.ExecuteAction": async p => ({ ok: await runAction(p.action || "") }),
  "Player.GetItem": () => nowPlayingItem(),
  "Player.PlayPause": async () => { await settled(); handle("play", false); return { playing: Live.active ? !Live.video.paused : Player.playing }; },
  "Player.Stop": async () => {
    Live.stop();   // the tv screen and the now playing screen close themselves when playback stops
    BgVod.stop();
    Player.stop();
    if (top() instanceof VodPage) { await settled(); back(); } // a movie: leaving it stops it
    return { stopped: true };
  },
  "Player.Open": async p => {
    const q = p.channel || p.query || (p.item && (p.item.channel || p.item.channelid)) || "";
    if (!q) throw new Error("which channel?");
    const ch = await tuneChannel(String(q));
    return { channel: `${ch.number} ${ch.name}`.trim() };
  },
  "PVR.GetChannels": async () => { voiceChannels = null; const c = await channelList(); return { count: c.length, channels: c.map(x => ({ name: x.name, number: x.number })) }; },
  "Player.PlayMusic": p => playMusicBy(p),
  "Player.PlayRadio": p => playRadioStation(p),
  "Player.Skip": async p => {
    const d = p.direction != null ? (Number(p.direction) < 0 ? -1 : 1) : p.forward === false ? -1 : 1;
    if (!Player.track) throw new Error("nothing is playing");
    d > 0 ? Player.next() : Player.prev();
    return { ok: true };
  },
  "Application.GetProperties": () => ({ volume: Volume.level, muted: Volume.muted }),
  "Application.SetVolume": p => {
    let v = p.volume;
    if (v === "increment") v = Volume.level + 10;
    if (v === "decrement") v = Volume.level - 10;
    return { volume: Volume.set(v) };
  },
  "Application.LaunchVacuumTube": async () => {
    const r = await Apps.call("/apps/youtube/launch", {});
    if (!r.ok) return { error: r.error || "youtube couldn't be opened" };
    Live.stop(); Player.stop();
    toast("opening youtube…");
    return { ok: true };
  },
  "Guide.Refresh": () => GuideFeed.push(),
  "Guide.ShowResults": p => showGuideResults(p), // the assistant's answer to "is football on?", as a list
  // picture in picture, same answers as the old hub
  // picture in picture (up to four pictures), same answers as the old hub
  "Player.AddDualChannel": async p => {
    const q = String(p.channel || p.query || "").trim();
    if (!q) return { error: "Which channel?" };
    if (!Live.active) { const ch = await tuneChannel(q); return { ok: true, channel: ch.name, mode: "tuned" }; }
    const idx = dualChannelIndex(q);
    if (idx < 0) return { error: "Channel not found: " + q };
    const name = Live.guide.channels[idx].name;
    if (Dual.showing(idx) >= 0) return Dual.on ? { ok: true, channel: name, mode: "already" } : { error: "Already watching that channel" };
    if (Dual.mode === "leaving") await wait(600);
    if (Dual.mode === "pick") { Dual.choose(idx); return { ok: true, channel: name, mode: "added" }; }
    if (Dual.on && Dual.addSlot() < 0) { // all four in use: the last small one changes channel
      const last = Dual.smalls[Dual.smalls.length - 1];
      last.i = idx; last.video.style.opacity = 0; Dual.open(last, true); Dual.overlay();
      return { ok: true, channel: name, mode: "swap" };
    }
    await showPlayer(); await settled();
    const pg = top(); if (pg instanceof LivePage) pg.setMode("hidden");
    if (!Dual.pick(idx) || !Dual.choose(idx)) return { error: "Could not add channel." };
    return { ok: true, channel: name, mode: "added" };
  },
  "Player.RemoveDualChannel": async p => {
    if (!Dual.on) return { error: "Not in dual view" };
    if (Dual.mode === "pick") { Dual.key("back"); return { ok: true, removed: "pick" }; }
    if (Dual.mode !== "play") { Dual.close(); return { ok: true, removed: "dual" }; }
    const q = String(p.channel || "").trim();
    if (!q) { Dual.remove(Dual.smalls.length); return { ok: true, removed: "secondary" }; } // the last one added
    const idx = dualChannelIndex(q);
    if (idx < 0) return { error: "Channel not found: " + q };
    const k = Dual.showing(idx);
    if (k < 0) return { error: "That channel is not in dual view" };
    const name = Live.guide.channels[idx].name;
    Dual.remove(k);
    return { ok: true, removed: name, kept: k === 0 ? "secondary" : "primary" };
  },
  "Player.ExitDualView": async p => {
    if (!Dual.on) return { ok: true, kept: "primary" };
    const keep = p.keep === "secondary" ? Math.min(1, Dual.smalls.length) : 0;
    const i = Dual.pics()[keep].i;
    Dual.exit(keep);
    return { ok: true, kept: keep ? "secondary" : "primary", playIndex: i };
  },
  // lyrics, same answers as the old hub
  "Player.SetLyricsOverlay": async p => {
    const off = p.enabled === false || p.enabled === 0 || p.enabled === "0" || p.enabled === "false" || p.off === true;
    return Lyrics.set(!off);
  },
  "Player.GetLyrics": async p => {
    const t = Player.track;
    if (!t) return { error: "Nothing is playing." };
    if (t.live) return { error: "Lyrics are not available for radio." };
    const max = clamp(Number(p.maxLines) || 24, 1, 80);
    const lines = await Lyrics.load(t);
    if (!lines || !lines.length) return { error: "No lyrics for this track." };
    const slice = lines.slice(0, max).map(l => l.text);
    return {
      ok: true, lines: slice, text: slice.join(". "), plain: lines.map(l => l.text).join("\n"),
      truncated: lines.length > max, lineCount: lines.length, title: t.title || "", artist: (t.artist && t.artist.name) || "",
    };
  },
};

RPC["UI.ActivateView"] = RPC["GUI.ActivateWindow"];

// keeps asking the helper for the next voice command (long-poll), runs it and sends back the answer
const VoiceLink = {
  async run(cmd) {
    if (!/^(JSONRPC\.Ping|Player\.GetItem|Application\.GetProperties|PVR\.GetChannels|Player\.GetLyrics|Guide\.Refresh)$/.test(cmd.method)) { Saver.poke(); Saver.hide(); } // a voice command wakes the screen
    try {
      const fn = RPC[cmd.method];
      if (!fn) throw new Error(`unknown command ${cmd.method}`);
      return { id: cmd.id, result: await fn(cmd.params || {}) };
    } catch (e) {
      return { id: cmd.id, error: { code: -32000, message: lower(e.message || String(e)) } };
    }
  },
  async start() {
    if (location.protocol === "file:") return; // opened directly: no helper, no voice
    if (NATIVE) { // the Shield's built-in helper hands each command straight to the page
      window.__voice = async (id, method, params) => {
        const reply = await this.run({ id, method, params });
        let text; try { text = JSON.stringify(reply); } catch { text = JSON.stringify({ id, error: { message: "couldn't send the answer" } }); }
        NATIVE.voiceReply(id, text);
      };
      NATIVE.voiceReady();
      return;
    }
    const H = { "X-Media-Center": "1" };
    for (;;) {
      let cmd;
      try {
        const r = await fetch("/jsonrpc/poll", { headers: H, cache: "no-store" });
        if (!r.ok) { await wait(3000); continue; }
        cmd = await r.json();
      } catch { await wait(3000); continue; }
      if (!cmd || cmd.id == null) continue;
      const reply = await this.run(cmd);
      fetch("/jsonrpc/result", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(reply) }).catch(() => {});
    }
  },
};

// keeps the helper's copy of the tv guide fresh, so "what's on tonight" works by voice
const GuideFeed = {
  async push() {
    if (location.protocol === "file:" || !Emby.connected) return { count: 0 };
    const chans = await Emby.channels();
    const from = Date.now() - HOUR, to = Date.now() + 24 * HOUR, programs = []; // a day ahead: "is the game on tonight" in the morning
    for (let i = 0; i < chans.length; i += 60) {
      const batch = await Emby.programs(chans.slice(i, i + 60).map(c => c.id), from, to).catch(() => []);
      batch.forEach(p => programs.push({
        Id: p.id, ChannelId: p.channelId, Name: p.title, EpisodeTitle: p.ep, Overview: p.overview,
        Genres: [...(p.genres || []), ...(p.isMovie ? ["Movie"] : [])],
        StartDate: new Date(p.start).toISOString(), EndDate: new Date(p.end).toISOString(),
      }));
    }
    const body = { channels: chans.map(c => ({ Id: c.id, Name: c.name, ChannelNumber: c.number })), programs };
    if (NATIVE) NATIVE.guideCache(JSON.stringify(body));
    else await fetch("/guide/cache", { method: "POST", headers: { "X-Media-Center": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { count: programs.length };
  },
  start() {
    if (location.protocol === "file:") return;
    const run = () => this.push().catch(() => {});
    setTimeout(run, 8000);              // shortly after start-up
    setInterval(run, 30 * 60 * 1000);   // and every half hour
  },
};

/* ============ remote control from Emby ============
   The app keeps a live connection to Emby and announces itself as a player that takes commands, like
   Emby's own apps. So the Emby phone app or web page can "play on Media Center", pause, jump, stop,
   change the volume or show a message — and server plugins can too (ComSkipper jumps over
   commercials this way, using the Comskip .edl files next to recordings). Reconnects by itself. */
const Remote = {
  ws: null, wait: 5000, keep: null, timer: null, live: false,
  start() {
    this.stop(true);
    if (!Emby.connected || location.protocol === "file:") return;
    let ws;
    try { ws = Emby.socket(); } catch { return this.later(); }
    this.ws = ws;
    ws.onopen = () => { this.live = true; this.wait = 5000; Emby.announce().catch(() => {}); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.handle(m); };
    ws.onclose = () => { this.live = false; clearInterval(this.keep); if (this.ws === ws) this.later(); };
    ws.onerror = () => {}; // (onclose follows and retries)
  },
  later() { // try again, waiting a little longer each time (up to a minute)
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.start(), this.wait);
    this.wait = Math.min(60000, this.wait * 2);
  },
  stop(quiet) {
    clearTimeout(this.timer); clearInterval(this.keep);
    const ws = this.ws; this.ws = null; this.live = false;
    if (ws) try { ws.close(); } catch {}
  },
  send(type, data) { try { this.ws && this.ws.readyState === 1 && this.ws.send(JSON.stringify(data === undefined ? { MessageType: type } : { MessageType: type, Data: data })); } catch {} },
  handle(m) {
    const d = m.Data || {};
    if (m.MessageType === "ForceKeepAlive") { // Emby wants a sign of life every so often
      clearInterval(this.keep);
      this.keep = setInterval(() => this.send("KeepAlive"), Math.max(5, (+d || 60) * 0.5) * 1000);
      this.send("KeepAlive");
    } else if (m.MessageType === "Playstate") this.playstate(d);
    else if (m.MessageType === "GeneralCommand") this.general(d);
    else if (m.MessageType === "Play") this.play(d).catch(e => toast("couldn't play that — " + lower(e.message)));
  },
  // pause / play / jump / stop / next — for whatever is playing (a movie or recording, youtube, live tv, music)
  playstate(d) {
    Saver.poke(); Saver.hide();
    const p = top(), cmd = d.Command, at = (d.SeekPositionTicks || 0) / 1e7;
    if (p instanceof VodPage || p instanceof YtPage) {
      const paused = p instanceof YtPage ? p.isPaused : p.video.paused;
      if (cmd === "Seek") p.seekTo(at);
      else if (cmd === "Pause" && !paused || cmd === "Unpause" && paused || cmd === "PlayPause") p.togglePause();
      else if (cmd === "Stop") back();
      else if (cmd === "FastForward" || cmd === "NextTrack") p.seek(skipBy(1));
      else if (cmd === "Rewind" || cmd === "PreviousTrack") p.seek(skipBy(-1));
      return;
    }
    if (BgVod.active) {
      const paused = BgVod.page.video.paused;
      if (cmd === "Pause" && !paused || cmd === "Unpause" && paused || cmd === "PlayPause") BgVod.togglePause();
      else if (cmd === "Stop") BgVod.stop();
      return;
    }
    if (Live.active) {
      const paused = Live.video.paused;
      if (cmd === "Pause" && !paused || cmd === "Unpause" && paused || cmd === "PlayPause") handle("play");
      else if (cmd === "Stop") Live.stop();
      else if ((cmd === "NextTrack" || cmd === "PreviousTrack") && p instanceof LivePage) p.changeChannel(cmd === "NextTrack" ? 1 : -1);
      return;
    }
    if (Player.track) {
      if (cmd === "Seek" && Player.track.stream && !Player.track.live) { audio.currentTime = at; Player.pos = at; emit("tick"); }
      else if (cmd === "Pause" && Player.playing || cmd === "Unpause" && !Player.playing || cmd === "PlayPause") Player.toggle();
      else if (cmd === "Stop") Player.stop();
      else if (cmd === "NextTrack") Player.next();
      else if (cmd === "PreviousTrack") Player.prev();
    }
  },
  general(d) {
    const a = d.Arguments || {}, n = d.Name;
    if (n !== "DisplayMessage") { Saver.poke(); Saver.hide(); }
    if (n === "DisplayMessage") toast(lower(a.Text || a.Header || ""));
    else if (n === "SetVolume") Volume.set(+a.Volume);
    else if (n === "VolumeUp" || n === "VolumeDown") Volume.set(Volume.level + (n === "VolumeUp" ? 5 : -5));
    else if (n === "ToggleMute" || n === "Mute" || n === "Unmute") { Volume.muted = n === "Mute" ? true : n === "Unmute" ? false : !Volume.muted; Volume.apply(); }
    else if (n === "GoHome") goHome();
    else if (n === "GoToSettings") openSection("settings");
    else if (n === "Back") handle("back");
    else if (n === "Select") handle("ok");
    else if (["MoveUp", "MoveDown", "MoveLeft", "MoveRight"].includes(n)) handle(n.slice(4).toLowerCase());
    else if (n === "DisplayContent" && a.ItemId) this.play({ ItemIds: [a.ItemId], PlayCommand: "Show" }).catch(() => {});
  },
  // "play on Media Center": music, a movie / episode / recording, a channel, photos, or a show's page
  async play(d) {
    const ids = d.ItemIds || []; if (!ids.length) return;
    const r = await Emby.resolvePlay(ids), from = (d.StartPositionTicks || 0) / 1e7, how = d.PlayCommand || "PlayNow";
    Saver.poke(); Saver.hide();
    await settled();
    if (r.kind === "music") {
      let list = r.list; if (!list.length) return;
      if (how === "PlayShuffle") list = shuffled(list);
      if ((how === "PlayNext" || how === "PlayLast") && Player.track) {
        if (how === "PlayNext") Player.queue.splice(Player.i + 1, 0, ...list); else Player.queue.push(...list);
        return toast(`added ${list.length} song${list.length === 1 ? "" : "s"} to what's playing`);
      }
      Player.play(list, 0);
      if (!(top() instanceof NowPlaying)) go(new NowPlaying());
    } else if (r.kind === "video") {
      const v = r.list[0];
      if (how === "Show") return go(new VideoPage(v));
      go(new VodPage(v, from || 0));
    } else if (r.kind === "channel") {
      const chans = await channelList(), ch = chans.find(c => c.id === r.list[0].id);
      if (!ch) return toast("that channel isn't in the guide");
      const g = new GuidePage(); g.channels = channelsWith(chans, ch);
      go(new LivePage(g, g.channels.indexOf(ch)), { replace: top() instanceof LivePage });
    } else if (r.kind === "photo") go(new PhotoPage(r.list, 0, "pictures"));
    else if (r.kind === "show") openShow(r.list[0]);
  },
};

/* ============ the Zune HD's music screensaver (settings → playback → screensaver look) ============
   Like the Zune HD on a TV: over the dim artist photo, a tilted group of bands — one name in giant
   thin letters, the others in bold capitals and a thin line with the song's time — each band sliding
   along the slant at its own speed, some the opposite way, with the cover drifting on its own. Every 17–23 seconds it changes direction: the group speeds
   off along its slant, smearing as it fades; half a second of just the photo; then a new group, at a
   new angle and moving the other way, slides in already moving and settles into the slow drift. */
const ZuneSaver = {
  ANGLES: [-58, -72, -84, -12, -34, -66, 6, -46],
  host: null, shot: null, timer: null, angle: null, dir: 1, run: 0, turn: -1,
  start(host) { this.host = host; this.stop(); this.next(true); },
  stop() {
    this.run++; clearTimeout(this.timer); this.timer = null;
    if (this.host) this.host.querySelectorAll(".zh-shot").forEach(e => e.remove());
    this.shot = null;
  },
  // a new song: change direction now, so the new names come in
  song() { if (this.host && Saver.on) { clearTimeout(this.timer); this.next(); } },
  // The bands, all at the same slant, each sliding along it at its own speed (px a second); a minus
  // runs the other way. The giant letters take turns: the song, then the artist, then the album.
  // (Seen in the video: the album in big bold capitals and again smaller, and a thin line of the song
  // and its time running against them, while the cover drifts on its own.)
  bands(t) {
    const album = (t.live ? t.station.title : t.album.title) || "", artist = t.artist.name || "", song = t.title || "";
    const giant = [song, artist, album].filter(Boolean)[++this.turn % [song, artist, album].filter(Boolean).length] || song;
    const others = [album, artist, song].filter(x => x && x !== giant);
    return [
      { cls: "zh-big", text: giant, top: -470, v: 16 },
      { cls: "zh-b1", text: others[0] || giant, top: -540, v: -34 },
      { cls: "zh-b2", text: others[0] || giant, top: 236, v: -52 },
      { cls: "zh-b3", text: others[1] || others[0] || giant, top: 372, v: 40, time: true },
    ];
  },
  time() {
    const e = this.shot; if (!e) return;
    const txt = this.timeText ? this.timeText() : Player.track && !Player.track.live ? fmtT(Player.pos) : "";
    e.querySelectorAll(".zh-t").forEach(x => { x.textContent = txt; });
  },
  // src: where the names come from (the idle screensaver hands its cards in); normally the song playing
  src: null, timeText: null,
  async next(first) {
    const run = ++this.run, t = this.src ? this.src() : Player.track;
    clearTimeout(this.timer);
    if (!t || !this.host) return;
    if (this.shot) { await this.leave(this.shot); if (run !== this.run) return; await wait(500); if (run !== this.run) return; }
    this.enter(this.src ? t : Player.track || t);
    this.timer = setTimeout(() => this.next(), (17 + Math.random() * 6) * 1000);
  },
  enter(t) {
    // a new angle each time (never the same twice), and the other direction
    const choices = this.ANGLES.filter(a => a !== this.angle);
    const a = this.angle = choices[Math.floor(Math.random() * choices.length)];
    const dir = this.dir = -this.dir;
    const e = this.shot = el("div", "zh-shot");
    this.host.append(e);
    const life = 40000; // longer than a group is ever on screen
    for (const b of this.bands(t)) {
      const band = el("div", "zh-band " + b.cls);
      band.style.top = b.top + "px";
      const piece = b.time ? `<span>${esc(b.text)}</span><b class="zh-t"></b>` : `<span>${esc(b.text)}</span>`;
      band.innerHTML = piece;
      e.append(band);
      // repeated so the band never runs out, whichever way and however far it slides
      const one = band.offsetWidth || 1, n = Math.max(2, Math.ceil(7000 / one));
      band.innerHTML = Array(n).fill(piece).join("");
      const w = band.offsetWidth, start = -w / 2 + (Math.random() - 0.5) * one;
      const go = b.v * dir * life / 1000;
      band.animate([{ transform: `translateX(${start}px)` }, { transform: `translateX(${start + go}px)` }],
        { duration: life, easing: "linear", fill: "forwards" });
    }
    // the cover drifts on its own, near the big bold band
    const art = el("img", "zh-art"); art.alt = ""; setCover(art, t.live ? t.station : t.album); e.append(art);
    const ax = (Math.random() - 0.5) * 900;
    art.animate([{ transform: `translateX(${ax}px)` }, { transform: `translateX(${ax + 22 * dir * life / 1000}px)` }],
      { duration: life, easing: "linear", fill: "forwards" });
    this.time();
    // the whole group turns to its angle and slides in, already moving, then settles
    const T = x => `rotate(${a}deg) translate(${x}px, 0px)`;
    e._move = { a, dir };
    e.animate([{ transform: T(-dir * 520), opacity: 0 }, { transform: T(0), opacity: 1 }], { duration: 900, easing: EASE, fill: "forwards" });
  },
  // speeds off along its slant, smearing and fading (the bands keep sliding as it goes)
  leave(e) {
    const cur = getComputedStyle(e).transform, m = e._move;
    e.getAnimations().forEach(x => x.cancel());
    e.style.transform = cur;
    const a = e.animate([
      { transform: cur, opacity: 1, filter: "blur(0px)" },
      { transform: `${cur} translate(${(m ? m.dir : 1) * 1700}px, 0px)`, opacity: 0, filter: "blur(10px)" },
    ], { duration: 380, easing: "cubic-bezier(.55,0,.9,.5)", fill: "forwards" });
    return done(a).then(() => e.remove());
  },
};

/* ============ the screensaver for when nothing is playing (settings → playback → idle screensaver) ============
   After a few minutes with nothing playing and no key pressed, random things from the library come
   and go: movies, tv shows, what's on tv now, new recordings, music, and (if switched on) your photos.
   Three looks: "backdrops" (the picture drifting, the title in giant thin letters), "zune bands" (the
   music screensaver's tilted bands, with library names), "cover wall" (a wall of covers swapping one at
   a time, now and then one grows to show what it is). Any key or the mouse only wakes it. */
const IdleSaver = {
  on: false, pool: [], i: 0, poolAt: 0, timer: null,
  eligible() {
    const p = top();
    if (Saver.on || Player.playing || Live.active || BgVod.page) return false;
    if (p instanceof VodPage || p instanceof LivePage || p instanceof PhotoPage) return false;
    if (document.activeElement && document.activeElement.tagName === "INPUT") return false;
    return !busy;
  },
  kinds() { return IDLE_KINDS.map(k => k[0]).filter(k => Prefs.get("idle_" + k)); },
  init() {
    this.el = el("div", "saver idle");
    this.el.innerHTML = `<div class="sv-bg"></div><div class="sv-shade"></div><div class="is-body"></div>`;
    $stage.append(this.el);
    setInterval(() => {
      const mins = Number(Prefs.get("idleSaver")) || 0;
      if (!this.on && mins > 0 && Date.now() - Saver.last >= mins * 60000 && this.eligible()) this.show();
      if (this.on && this.look === "bands") IdleBands.time();
    }, 1000);
  },
  // the cards: fresh from Emby every half hour (or the sample library when not signed in)
  async load() {
    if (this.pool.length && Date.now() - this.poolAt < 30 * 60000) return;
    let cards = [];
    if (Emby.connected) cards = await Emby.saverPool(this.kinds(), Prefs.get("chHidden") || []).catch(() => []);
    if (!Emby.connected && this.kinds().includes("music")) { // (the sample library only has music)
      cards = cards.concat(LIB.albums.map(a => ({ kind: "music", label: "music", title: a.title, info: [a.artist.name, a.year].filter(Boolean).join(" · "), album: a, wide: null, hue: a.hue })));
    }
    // mixed up, so the same kind doesn't come twice in a row too often
    this.pool = cards.map(c => [Math.random(), c]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    this.poolAt = Date.now(); this.i = 0;
  },
  card() { if (!this.pool.length) return null; const c = this.pool[this.i % this.pool.length]; this.i++; return c; },
  // a card's pictures: the wide one for the background (else its poster, softened), the poster / cover
  wideOf: c => c.wide || (c.album ? cover(c.album) : c.poster) || Art.photo(c.title, c.hue),
  posterOf: c => c.album ? cover(c.album) : c.poster || c.wide || genCover({ title: c.title, hue: c.hue, id: c.title }),
  setBg(c) {
    const bg = this.el.querySelector(".sv-bg"), img = el("img");
    img.alt = ""; img.src = this.wideOf(c);
    img.classList.toggle("soft", !c.wide); // a poster stretched to the whole screen is blurred, like a backdrop
    img.style.animationName = "svdrift" + (1 + Math.floor(Math.random() * 3));
    img.onload = () => { img.classList.add("in"); setTimeout(() => [...bg.children].slice(0, -1).forEach(o => o.remove()), 2600); };
    img.onerror = () => { if (!img.dataset.tried) { img.dataset.tried = 1; img.classList.add("soft"); img.src = Art.photo(c.title, c.hue); } else img.remove(); };
    bg.append(img);
  },
  async show() {
    this.on = true; this.look = Prefs.get("idleLook");
    const body = this.el.querySelector(".is-body"); body.innerHTML = "";
    this.el.className = "saver idle look-" + this.look;
    this.el.classList.add("on");
    document.documentElement.classList.add("nopointer");
    await this.load();
    if (!this.on || !this.pool.length) return;
    if (this.look === "bands") {
      const host = el("div", "sv-zune"); body.append(host);
      IdleBands.host = host;
      IdleBands.src = () => { const c = this.card(); if (!c) return null; this.setBg(c); return this.asTrack(c); };
      IdleBands.start(host);
    } else if (this.look === "wall") this.wall(body);
    else this.backdrops(body);
  },
  hide() {
    if (!this.on) return;
    this.on = false;
    this.el.classList.remove("on");
    clearTimeout(this.timer); clearInterval(this.timer);
    const run = ++this.run;
    setTimeout(() => { if (this.on || run !== this.run) return; IdleBands.stop(); this.el.querySelector(".is-body").innerHTML = ""; this.el.querySelector(".sv-bg").innerHTML = ""; }, 1300);
  },
  run: 0,
  // for the bands: a card dressed up as a song (giant letters take turns: title, then its label, then its info)
  asTrack(c) {
    return { title: c.title, artist: { name: c.label }, album: { title: c.info || c.label, imgs: [this.posterOf(c)], id: c.title, hue: c.hue }, live: false };
  },
  // ---- look 1: backdrops ----
  backdrops(body) {
    const show = () => {
      const c = this.card(); if (!c || !this.on) return;
      this.setBg(c);
      const old = [...body.children];
      old.forEach(o => { o.classList.add("out"); setTimeout(() => o.remove(), 900); });
      const until = c.until ? "until " + new Date(c.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase() : "";
      const card = el("div", "ib-card");
      card.innerHTML = `<div class="ib-title"></div><div class="ib-label"></div><div class="ib-info"></div><div class="ib-text"></div>`;
      card.querySelector(".ib-title").textContent = c.title;
      card.querySelector(".ib-label").textContent = c.label;
      card.querySelector(".ib-info").textContent = [c.info, until].filter(Boolean).join(" · ");
      card.querySelector(".ib-text").textContent = c.text || "";
      body.append(card);
      // the giant title drifts slowly sideways while it's up; the lines below slide in one after another
      const t = card.querySelector(".ib-title"), d = Math.random() < 0.5 ? -1 : 1;
      t.animate([{ transform: `translateX(${-d * 60}px)` }, { transform: `translateX(${d * 60}px)` }], { duration: 18000, easing: "linear", fill: "both" });
      slideIn([t, card.querySelector(".ib-label"), card.querySelector(".ib-info"), card.querySelector(".ib-text")], 1, { dist: 160, dur: 900, stagger: 90 });
    };
    show();
    this.timer = setInterval(show, 16000);
  },
  // ---- look 3: the cover wall ----
  wall(body) {
    const COLS = 8, ROWS = 4, S = 240, gapX = (1920 - COLS * S) / 2, gapY = (1080 - ROWS * S) / 2;
    const grid = el("div", "iw-grid"); body.append(grid);
    const tiles = [];
    for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS; k++) {
      const t = el("div", "iw-tile"), img = el("img"); img.alt = "";
      Object.assign(t.style, { left: gapX + k * S + "px", top: gapY + r * S + "px" });
      const c = this.card(); img.src = this.posterOf(c); t.card = c;
      t.append(img); grid.append(t); tiles.push(t);
    }
    tiles.forEach((t, i) => t.animate([{ opacity: 0, transform: "scale(.85)" }, { opacity: 1, transform: "none" }], { duration: 700, delay: (i % COLS) * 40 + Math.floor(i / COLS) * 60, easing: EASE, fill: "backwards" }));
    let n = 0, feature = null;
    const flip = t => { // the tile turns edge-on, its picture changes, it turns back
      const c = this.card(); if (!c) return;
      const img = t.querySelector("img"), nu = new Image(); nu.src = this.posterOf(c);
      const go = () => {
        t.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(90deg)" }], { duration: 260, easing: EASE_IN }).finished.then(() => {
          img.src = nu.src; t.card = c;
          t.animate([{ transform: "rotateY(-90deg)" }, { transform: "rotateY(0deg)" }], { duration: 420, easing: EASE });
        }).catch(() => {});
      };
      nu.onload = go; nu.onerror = () => {};
    };
    const grow = () => { // one tile grows over its neighbours and shows what it is, then settles back
      if (feature) return;
      const k = Math.floor(Math.random() * (COLS - 3)), r = Math.floor(Math.random() * (ROWS - 1));
      const t = tiles[r * COLS + k], c = t.card; if (!c) return;
      this.setBg(c);
      feature = el("div", "iw-feature");
      Object.assign(feature.style, { left: t.style.left, top: t.style.top });
      feature.innerHTML = `<img alt=""><div class="iw-info"><div class="iw-label"></div><div class="iw-title"></div><div class="iw-line"></div></div>`;
      feature.querySelector("img").src = t.querySelector("img").src;
      feature.querySelector(".iw-label").textContent = c.label;
      feature.querySelector(".iw-title").textContent = c.title;
      const until = c.until ? "until " + new Date(c.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase() : "";
      feature.querySelector(".iw-line").textContent = [c.info, until].filter(Boolean).join(" · ");
      grid.append(feature);
      grid.classList.add("dim");
      feature.animate([{ transform: "scale(.5)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 700, easing: EASE, fill: "backwards" });
      slideIn([...feature.querySelectorAll(".iw-info > div")], 1, { dist: 120, dur: 700, stagger: 80 });
      const f = feature;
      setTimeout(() => {
        grid.classList.remove("dim");
        f.animate([{ transform: "none", opacity: 1 }, { transform: "scale(.5)", opacity: 0 }], { duration: 450, easing: EASE_IN, fill: "forwards" }).finished.then(() => f.remove()).catch(() => {});
        if (feature === f) feature = null;
      }, 7000);
    };
    this.timer = setInterval(() => {
      if (!this.on) return;
      n++;
      if (n % 6 === 0) grow(); else flip(tiles[Math.floor(Math.random() * tiles.length)]);
    }, 2200);
  },
};
// the bands for the idle screensaver: the same moves as the music one, its own copy
const IdleBands = Object.assign(Object.create(ZuneSaver), {
  host: null, shot: null, timer: null, angle: null, dir: 1, run: 0, turn: -1,
  timeText: () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase(),
});

/* ============ music screensaver (Zune "now playing" style) ============
   While music or radio plays and nothing has been pressed for a while (settings → playback →
   music screensaver), the screen fills with the artist's photos, slowly drifting and changing, with
   the artist, song and album names crawling across in giant type, and a small "now playing" corner
   (plus a few lines of the artist's biography when Emby has one). Any key, the mouse or a voice
   command brings back exactly the screen you were on; that first key press does nothing else. */
const Saver = {
  on: false, last: Date.now(), shown: null, pics: [], pic: 0,
  poke() { this.last = Date.now(); },
  eligible() {
    const p = top();
    if (!Player.playing || !Player.track || Live.active) return false;
    if (p instanceof VodPage || p instanceof LivePage || p instanceof PhotoPage) return false;
    if (Lyrics.on && p instanceof NowPlaying && p.lyr) return false; // reading the lyrics
    if (document.activeElement && document.activeElement.tagName === "INPUT") return false;
    return !busy;
  },
  init() {
    this.el = el("div", "saver");
    this.el.innerHTML = `<div class="sv-bg"></div><div class="sv-shade"></div>
      <div class="sv-crawl a"><div></div></div><div class="sv-crawl b"><div></div></div><div class="sv-crawl c"><div></div></div>
      <div class="sv-now"><img class="sv-art" alt=""><div class="sv-tx"><div class="sv-t1"></div><div class="sv-t2 sc"></div><div class="sv-bar"><i></i></div></div></div>
      <div class="sv-bio"></div><div class="sv-zune"></div>`;
    $stage.append(this.el);
    setInterval(() => this.tick(), 1000);
  },
  tick() {
    const secs = Prefs.get("saver");
    if (!this.on) {
      if (secs > 0 && Date.now() - this.last >= secs * 1000 && this.eligible()) this.show();
      return;
    }
    if (!Player.track) return this.hide();             // music stopped
    if (Player.track !== this.shown || Player.track.title !== this.shownTitle) { this.fill(); if (this.zune) ZuneSaver.song(); } // next song (radio: new song info)
    if (this.zune) ZuneSaver.time();
    const d = Player.dur, bar = this.el.querySelector(".sv-bar i");
    bar.style.width = d && !Player.track.live ? Math.min(100, Player.pos / d * 100) + "%" : "0";
  },
  show() {
    this.on = true;
    this.fill();
    // settings → playback → screensaver look: the Zune HD's moving letters, or the scrolling text
    this.zune = Prefs.get("saverLook") !== "crawl";
    this.el.classList.toggle("zh", this.zune);
    if (this.zune) ZuneSaver.start(this.el.querySelector(".sv-zune"));
    this.el.classList.add("on");
    document.documentElement.classList.add("nopointer");
  },
  hide() {
    IdleSaver.hide(); // (the screensaver for when nothing plays goes too)
    if (!this.on) return;
    this.on = false; this.poke();
    this.el.classList.remove("on");
    clearInterval(this.picTimer); clearInterval(this.bioTimer);
    if (this.zune) setTimeout(() => { if (!this.on) ZuneSaver.stop(); }, 1700); // after the fade-out
  },
  async fill() {
    const t = Player.track; if (!t) return;
    this.shown = t; this.shownTitle = t.title;
    const crawl = (sel, text) => { // the text repeated (two identical halves), so the loop is seamless even for short names
      const c = this.el.querySelector(sel + " div");
      c.innerHTML = `<span>${esc(text)}</span>`.repeat(8);
    };
    crawl(".a", t.artist.name);
    crawl(".b", t.title);
    crawl(".c", t.live ? t.station.title : t.album.title);
    setCover(this.el.querySelector(".sv-art"), t.album);
    this.el.querySelector(".sv-t1").textContent = t.title;
    this.el.querySelector(".sv-t2").textContent = [t.artist.name, t.live ? `${t.station.title} · ${t.station.net.name}` : t.album.title].filter(Boolean).join(" · ");
    this.el.querySelector(".sv-bio").textContent = "";
    // pictures: the artist's backdrops from Emby, else the artist photo / song cover we already have
    // (radio: the photos ArtistArt found, or the song's cover blurred)
    this.setPics(t.artist.pics || [artistPhoto(t.artist)], softArtist(t));
    clearInterval(this.bioTimer);
    const info = Emby.connected ? await Emby.artistInfo(t.artist) : null;
    if (Player.track !== t || !this.on) return;
    if (info && info.backdrops.length && !t.artist.pics) this.setPics(info.backdrops);
    if (info && info.bio) this.bio(info.bio);
  },
  setPics(list, soft = false) {
    this.pics = list.filter(Boolean); this.pic = 0;
    clearInterval(this.picTimer);
    this.addPic(this.pics[0], soft);
    if (this.pics.length > 1) this.picTimer = setInterval(() => { this.pic = (this.pic + 1) % this.pics.length; this.addPic(this.pics[this.pic]); }, 16000);
  },
  addPic(src, soft = false) { // a new photo fades in over the last one, each drifting a different way
    if (!src) return;
    const bg = this.el.querySelector(".sv-bg"), img = el("img");
    img.alt = ""; img.src = src;
    if (soft) img.classList.add("soft"); // a small cover, blurred instead of stretched
    img.style.animationName = "svdrift" + (1 + Math.floor(Math.random() * 3));
    img.onload = () => {
      img.classList.add("in");
      setTimeout(() => [...bg.children].slice(0, -1).forEach(o => o.remove()), 2600);
    };
    img.onerror = () => img.remove();
    bg.append(img);
  },
  bio(text) { // a few sentences at a time, fading from one passage to the next
    const parts = [], words = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
    let cur = "";
    for (const w of words) { if ((cur + " " + w).length > 260 && cur) { parts.push(cur.trim()); cur = w; } else cur += " " + w; }
    if (cur.trim()) parts.push(cur.trim());
    const box = this.el.querySelector(".sv-bio");
    let i = 0;
    const next = () => {
      box.classList.remove("in");
      setTimeout(() => { box.textContent = parts[i % parts.length]; box.classList.add("in"); i++; }, 900);
    };
    next();
    if (parts.length > 1) this.bioTimer = setInterval(next, 20000);
  },
};

// for testing
window.__app = { Player, stack, go, back, quick, RPC, Volume, Live, Dual, Lyrics, VideoPage, Radio, Saver, artistPage, Tube, YtCodePage, Remote };

// hide the mouse pointer after 3 seconds without movement; moving the mouse brings it back
let pointerTimer = null;
function pointerIdle() {
  Saver.poke(); Saver.hide();
  document.documentElement.classList.remove("nopointer");
  clearTimeout(pointerTimer);
  pointerTimer = setTimeout(() => document.documentElement.classList.add("nopointer"), 3000);
}
addEventListener("mousemove", pointerIdle);
addEventListener("mousedown", pointerIdle);
pointerIdle();

Live.init();
BgVod.init();
Saver.init(); IdleSaver.init();
loadQuickplay();
go(new Home());
// settings → appearance → start on: open a section (or the last channel) instead of the home menu
(async () => {
  const where = Prefs.get("startup");
  if (!where || where === "home") return;
  await wait(900); // let the home menu finish coming in
  try {
    if (where === "live") { if (Prefs.get("lastChId")) { const ch = (await channelList()).find(c => c.id === Prefs.get("lastChId")); if (ch) await tuneChannel(ch.number || ch.name); } }
    else if (menuItems().includes(where)) await openSection(where);
  } catch {}
})();
VoiceLink.start(); // voice commands from the assistant
GuideFeed.start(); // guide copy for "what's on" questions
if (location.protocol !== "file:") Tube.account().catch(() => {}); // signed in to a youtube account? (adds subscriptions etc.)
Remote.start(); // remote control from Emby (phone app, web page, ComSkipper)
})();
