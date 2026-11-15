(() => {
"use strict";

/* ============ basics ============ */
const EASE = "cubic-bezier(.1,.9,.2,1)";      // fast start, long soft landing
const EASE_IN = "cubic-bezier(.6,0,.9,.45)";  // for things leaving the screen
const EASE_HERO = "cubic-bezier(.35,0,.1,1)"; // the menu word growing into a title
const $stage = document.getElementById("stage");
const $pages = document.getElementById("pages");
const $bgImg = document.getElementById("bgimg");

function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
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
const Prefs = {
  DEFAULTS: { npHide: 5, npArt: "hide", liveHide: 5, osdHide: 5, guideOk: "info", musicVol: 100, saver: 60 },
  load() { try { return { ...this.DEFAULTS, ...(JSON.parse(localStorage.getItem("mc.prefs")) || {}) }; } catch { return { ...this.DEFAULTS }; } },
  get(k) { return this.load()[k]; },
  set(k, v) { try { localStorage.setItem("mc.prefs", JSON.stringify({ ...this.load(), [k]: v })); } catch {} },
};

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
  const W = innerWidth, H = innerHeight;
  return qa(root, ".t").filter(e => {
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const clip = e.closest(".list");
    const b = clip ? clip.getBoundingClientRect() : { top: 0, bottom: H };
    return r.bottom > b.top && r.top < b.bottom && r.right > 0 && r.left < W;
  });
}
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
      { opacity: 1, transform: "translate(0px, 0px) scale(1)" },
    ], { id: "turn", duration: dur, delay: delay + i * stagger, easing: EASE, fill: "backwards" }));
  }));
}
// ZOOM OUT: going deeper, the old items zoom slightly past you and fade; going back, they shrink away.
function turnOut(els, dir, { dur = 240, stagger = 12 } = {}) {
  stagger = Math.min(stagger, 120 / Math.max(1, els.length));
  return Promise.all(els.map((e, i) => {
    cancelTurn(e);
    return done(e.animate([
      { opacity: 1, transform: "translate(0px, 0px) scale(1)" },
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
    { opacity: 1, transform: "none" },
  ], { id: "turn", duration: 550, delay, easing: EASE, fill: "backwards" }))));
}

// COVERS (album art, posters, show pictures) zoom in from their own center as they arrive / leave.
// (Named flipIn/flipOut for history: these used to spin in 3D.)
function flipIn(els, dir, delay = 120) {
  return Promise.all(els.map(e => {
    e.style.transformOrigin = "50% 50%";
    return done(e.animate([
      { opacity: 0, transform: `scale(${dir > 0 ? 0.8 : 1.15})` },
      { opacity: 1, transform: "scale(1)" },
    ], { id: "turn", duration: 600, delay, easing: EASE, fill: "backwards" }));
  }));
}
function flipOut(els, dir) {
  return Promise.all(els.map(e => done(e.animate([
    { opacity: 1, transform: "scale(1)" },
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
      { opacity: 1, transform: "none" },
    ], { id: "turn", duration: dur, delay: i * stagger, easing: EASE, fill: "backwards" }));
  }));
}
function slideOut(els, dir, { dist = 180, dur = 230, stagger = 30 } = {}) {
  stagger = Math.min(stagger, 200 / Math.max(1, els.length));
  return Promise.all(els.map((e, i) => {
    cancelTurn(e);
    return done(e.animate([
      { opacity: 1, transform: "none" },
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
  play(q, i) { Live.stop(); this.queue = q; this.i = i; this.playing = true; this.load(); emit("track", 1); }, // music stops live tv
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

// replace: the new page takes the current one's place (Back then skips over it)
async function go(page, { replace = false } = {}) {
  if (busy) return;
  busy = true;
  const cur = top();
  const hero = !replace && cur && cur.hero && cur.hero(page);
  if (hero) {
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
  if (heroName) await heroBack(cur, prev, heroName);
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
let bgSrc = null, bgTimer = null;
function applyBg(p) {
  const b = p.bg();
  const src = b.src || Art.wallpaper();
  $bgImg.style.transform = `translateX(${b.x || 0}px)`;
  $bgImg.parentNode.classList.toggle("drift", !!b.drift); // the picture slowly drifts and zooms (artist pages)
  clearTimeout(bgTimer);
  // no clock over full screen playback (watching tv, music now playing)
  $stage.classList.toggle("fullplay", p instanceof LivePage || p instanceof NowPlaying || p instanceof PhotoPage);
  // live tv playing full screen behind the menus replaces the background picture
  Live.place(p);
  if (Live.active && Live.modeFor(p) !== "corner") { $bgImg.style.opacity = 0; return; }
  if (src !== bgSrc) {
    bgSrc = src;
    $bgImg.style.opacity = 0;
    bgTimer = setTimeout(() => {
      $bgImg.onerror = () => { $bgImg.onerror = null; $bgImg.src = b.fallback || Art.wallpaper(); };
      $bgImg.src = src; $bgImg.style.opacity = b.opacity;
    }, 350);
  } else {
    $bgImg.style.opacity = b.opacity;
  }
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
  const view = el("div", "list"); view.style.height = height + "px";
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

/* ============ view options: the hidden side menu (like the old hub) ============
   On pages that have it (movies, tv shows, music albums & artists), pressing ← at the left edge of
   the covers slides a menu in from the left: layout (posters / list), size (small / medium / large)
   and sort order. ↑ ↓ move, Enter picks (the covers rearrange right away), → or Back closes it.
   Choices are remembered per area. */
const VIEW_SIZES = [["s", "small"], ["m", "medium"], ["l", "large"]];
const VIEW_KINDS = {
  video: {
    layouts: [["posters", "posters"], ["list", "list"]],
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
  get(key, kind) { return { mode: "posters", size: "m", sort: kind ? VIEW_KINDS[kind].sorts[0][0] : "title:asc", ...(this.all()[key] || {}) }; },
  set(key, v) { const a = this.all(); a[key] = v; try { localStorage.setItem("mc.views", JSON.stringify(a)); } catch {} },
  // the items in the chosen order (only where sorting makes sense: not "recent" or "continue")
  sorted(items, views, v) {
    if (!views.sort) return items;
    const [field, dir] = v.sort.split(":"), m = dir === "desc" ? -1 : 1;
    const name = x => String(x.sortName || x.title || x.name || "").toLowerCase();
    const val = x => field === "year" ? Number(x.year) || 0 : field === "added" ? Date.parse(x.added || "") || 0
      : field === "date" ? x.when || Date.parse(x.added || "") || 0
      : field === "score" ? x.score || 0 : field === "artist" ? String((x.artist && x.artist.name) || "").toLowerCase() : name(x);
    return items.slice().sort((a, b) => {
      if (views.folders && a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1; // folders stay first
      const A = val(a), B = val(b);
      const c = typeof A === "string" ? A.localeCompare(B) : A - B;
      return c * m || name(a).localeCompare(name(b));
    });
  },
  make(kind, v, items, focus) {
    const K = VIEW_KINDS[kind];
    if (v.mode === "list") return List({ items, itemH: K.rowH[v.size] || K.rowH.m, row: K.row, focus });
    const g = K.grid[v.size] || K.grid.m;
    const L = Grid({ items, ...g, cell: K.cell, focus });
    L.el.classList.add("sz-" + v.size, "k-" + kind);
    return L;
  },
};
const posterGrid = (items, focus) => Grid({ items, cols: 8, w: 186, h: 279, gap: 22, cell: CELL.poster, focus });

function playAndShow(tracks, i) {
  if (!tracks || !tracks[i]) return;
  Player.play(tracks, i);
  go(new NowPlaying());
}

/* ============ home ============ */
// Hub menu: order and which items show are set in settings → hub menu. Settings always stays last.
const MENU_ALL = ["music", "movies", "tv shows", "home videos", "tv guide", "radio", "youtube", "pictures"];
// how each menu word is written (the ids stay lowercase internally; the menu shows them in capitals)
const MENU_LABEL = { music: "Music", movies: "Movies", "tv shows": "TV Shows", "tv guide": "TV Guide", radio: "Radio", youtube: "YouTube", "home videos": "Home Videos", pictures: "Pictures", settings: "Settings" };
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
  ]).then(([resume, albums, movies]) => {
    quick.rows = [["continue", resume], ["new music", albums], ["new movies", movies]].filter(r => r[1].length);
    quick.loading = null;
  });
  return quick.loading;
}
function openItem(x) {
  if (!x) return;
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
    this.rows = (quick.rows || []).map(([label, list]) => {
      qp.append(el("div", "qp-label t", esc(title(label))));
      const row = el("div", "qp-row"); qp.append(row);
      return list.slice(0, 5).map(x => {
        const name = x.type === "Episode" && x.seriesName ? x.seriesName : x.title;
        const sub = x.artist && !x.type ? x.artist.name : x.type === "Episode" ? `s${x.season || "?"} e${x.episode || "?"}` : x.year;
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
    return { src: t ? artistPhoto(t.artist) : Art.wallpaper(), fallback: t ? Art.photo(t.artist.name, t.artist.hue) : null, opacity: 0.9, x: -280 + this.sec * 280 };
  }
  // menu word to grow into the next page's title
  hero(page) { return this.sec === 0 && page.heroName === this.mid ? this.heroItem(this.mid) : null; }
  heroItem(name) { return this.menuEls.find(e => e.dataset.id === name); }
  key(k) {
    // Back / Esc on the main menu: go full screen to whatever is playing (live tv first, then music)
    if (k === "back") {
      if (this.sec === 1) { this.setSec(0); return true; } // from quickplay, back to the menu first
      if (Live.active) { go(new LivePage(Live.guide, Live.i)); return true; }
      if (Player.track) { go(new NowPlaying()); return true; }
      return false;
    }
    if (this.sec === 0) {
      const i = this.items.indexOf(this.mid);
      if (k === "up" || k === "down") { this.mid = this.items[clamp(i + (k === "up" ? -1 : 1), 0, this.items.length - 1)]; this.paint(); return true; }
      if (k === "left") { if (this.rows.length) this.setSec(1); return true; }
      if (k === "ok") {
        if (this.mid === "youtube") { Apps.launch(); return true; } // opens VacuumTube; the app stays here
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
  bg() { return this.bgInfo || super.bg(); }
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
    } else {
      s.shown = s.data;
      this.list = s.view(s.data, this.focus[s.name] || 0);
    }
    return this.list;
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
    const via = location.protocol.startsWith("http") ? u => "/radio/stream?url=" + encodeURIComponent(u) : u => u;
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
    t.artist = { name: artist || t.station.net.name, hue: Emby.hashHue(artist || t.station.net.name), photo: art || t.station.img };
    t.album = { ...t.album, imgs: [art, t.station.img].filter(Boolean) };
    emit("track", 1);
  },
  // Keeps the song name and artwork current, like the old hub:
  // - every 1.5 s, ask the helper which song the station just announced in its stream (instant)
  // - when it changes, show the new name right away, then check the station's song list every
  //   2 s until its artwork for that song turns up
  // - every 20 s, the song list anyway (and the only source when there's no helper)
  watch(t) {
    clearInterval(this.timer); clearInterval(this.fast); clearTimeout(this.burst);
    if (!t || !t.live) return;
    const mine = () => Player.track === t;
    const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    const fromList = async () => {
      if (!mine() || !Player.playing) return null; // paused: don't keep changing the artist / backdrop
      const now = (await this.history(t))[0];
      if (!now || !mine()) return null;
      const title = now.title || now.display_title, artist = now.artist || now.display_artist;
      // a song announced in the stream wins until the list catches up with it
      if (t.icy && !(same(title, t.icy.title) && same(artist, t.icy.artist))) return false;
      this.show(t, title, artist, this.img(now.art_url, 800));
      return true;
    };
    const artBurst = (tries = 0) => {
      clearTimeout(this.burst);
      this.burst = setTimeout(async () => {
        if (!mine()) return;
        const got = await fromList();
        if (got === false && tries < 20) artBurst(tries + 1); // the list hasn't caught up yet (up to ~40 s)
      }, tries ? 2000 : 600);
    };
    const direct = new URL(t.stream, location.href).searchParams.get("url");
    if (direct) {
      this.fast = setInterval(async () => {
        if (!mine()) return clearInterval(this.fast);
        if (!Player.playing) return;
        const cur = new URL(t.stream, location.href).searchParams.get("url") || direct; // (a backup address may be in use)
        const m = await fetch("/radio/now?url=" + encodeURIComponent(cur), { headers: { "X-Media-Center": "1" }, cache: "no-store" })
          .then(r => r.ok ? r.json() : null).catch(() => null);
        if (!m || !m.raw || !mine() || (t.icy && t.icy.raw === m.raw)) return;
        t.icy = m;
        if (!same(m.title, t.title) || !same(m.artist, t.artist.name)) { // a new song: name now, artwork moments later
          this.show(t, m.title, m.artist, null);
          artBurst();
        }
      }, 1500);
    }
    fromList();
    this.timer = setInterval(fromList, 20000);
  },
};
const stationGrid = (items, focus) => Grid({ items, cols: 7, w: 220, h: 220, cell: CELL.station, focus });
function radioPage() {
  return new PivotPage({
    title: "radio", heroName: "radio",
    sections: RADIO_NETWORKS.map(net => ({
      name: net.name, load: () => Radio.channels(net), view: stationGrid,
      open: (st, i, list) => {
        if (!Radio.key) return toast("add your radio listen key in settings → radio");
        Player.play(list.map(s => Radio.track(s)), i);
        go(new NowPlaying());
      },
    })),
  });
}

/* ============ youtube (VacuumTube, started by the Media Center helper) ============ */
const Apps = {
  async call(path, body) {
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
  get titleKey() { return this.v.home ? "home videos" : this.v.type === "Episode" ? "tv shows" : "movies"; }
  render() {
    const v = this.v, ep = v.type === "Episode";
    const r = el("div", "video-page" + (ep ? " ep" : ""));
    const meta = ep
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
    btns.append(...this.btnEls); info.append(btns);
    r.append(info);
    this.paint();
    return r;
  }
  paint() { this.btnEls.forEach((b, i) => b.classList.toggle("focus", i === this.f)); }
  bg() { return { src: this.v.backdrop || this.v.img || null, opacity: 0.45 }; }
  key(k) {
    if (k === "left" || k === "right") { this.f = clamp(this.f + (k === "left" ? -1 : 1), 0, this.btnEls.length - 1); this.paint(); return true; }
    if (k === "ok") {
      if (!Emby.connected) { toast("sign in to emby in settings to play this"); return true; }
      const resume = this.v.resume > 60 && this.f === 0; // "resume 42m" is the first button when there's a place to go back to
      go(new VodPage(this.v, resume ? this.v.resume : 0));
      return true;
    }
    return false;
  }
}

/* ============ tv guide ============ */
const HALF = 30 * 60e3, HOUR = 60 * 60e3;
const G = { rowH: 92, rows: 6, hourPx: 468, span: 3 * HOUR, ahead: 12 * HOUR }; // sizes must match the .gd-* styles
const gx = ms => ms / HOUR * G.hourPx;
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
            overview: "A sample listing so the guide can be tried without an Emby server.", isNew: r() < 0.2, isMovie: d >= 4 * HALF });
          t += d;
        }
      }
      return out;
    },
  };
})();

class GuidePage extends Page {
  get titleKey() { return "tv guide"; }
  constructor() {
    super();
    this.heroName = "tv guide";
    this.ci = 0; this.top = 0; this.channels = undefined; this.progs = new Map(); this.pending = new Set();
    const now = Date.now();
    this.T0 = Math.floor(now / HALF) * HALF;   // the guide starts at the current half hour…
    this.t0 = this.T0;                          // …and this is where the visible 3 hours begin
    this.ft = now;                              // "focus time": which show is picked when moving up/down
  }
  get live() { return Emby.connected; }
  render() {
    const r = el("div", "guide-page");
    r.append(el("div", "sec-title z", "tv guide"));
    this.info = el("div", "gd-info zs"); r.append(this.info);
    const head = el("div", "gd-head zs"); this.timeX = el("div", "gd-x"); head.append(this.timeX); r.append(head);
    const chans = el("div", "gd-chans"); this.chY = el("div", "gd-y"); chans.append(this.chY);
    const grid = el("div", "gd-grid"); this.gridX = el("div", "gd-x"); this.gridY = el("div", "gd-y");
    this.nowLine = el("div", "gd-now");
    this.gridX.append(this.gridY, this.nowLine); grid.append(this.gridX);
    this.msg = el("div", "gd-msg t");
    r.append(chans, grid, this.msg);
    this.renderTimes();
    if (this.channels) this.renderRows();
    this.layout(false);
    return r;
  }
  mounted() {
    if (this.channels === undefined) {
      this.msg.textContent = "loading the guide…";
      Promise.resolve().then(() => this.live ? Emby.channels() : SampleGuide.channels())
        .then(c => { this.channels = c; }, e => { this.channels = null; this.err = e.message; })
        .then(() => {
          if (!this.el) return;
          if (!this.channels) { this.msg.textContent = "couldn't load the channels — " + lower(this.err); return; }
          if (!this.channels.length) { this.msg.textContent = "no live tv channels found on your emby server."; return; }
          this.msg.textContent = this.live ? "" : "sample guide — sign in to emby in settings to see your channels";
          this.msg.classList.toggle("note", !this.live);
          // tv playing? start on that channel (a few rows down, so the ones above it show too)
          const on = Live.active && Live.ch ? this.channels.findIndex(c => c.id === Live.ch.id) : -1;
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
        `${ch.img ? imgTag(ch.img, "logo") : ""}<div class="num">${esc(ch.number)}</div><div class="nm">${esc(ch.name)}</div>`);
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
        const cell = el("div", "gd-cell" + (p === focusP && i === this.ci ? " focus" : "") + (p.start <= now && p.end > now ? " on" : ""),
          `<div class="pt">${esc(p.title)}</div><div class="ps">${esc(p.ep || clock12(p.start))}${p.isNew ? ` <b>new</b>` : ""}</div>`);
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
      ? `<div class="it">${esc(p.title)}${p.ep ? `<span> · ${esc(p.ep)}</span>` : ""}</div>
         <div class="sc">${esc(ch.number)} ${esc(ch.name)} · ${clock12(p.start)} – ${clock12(p.end)}${flags.length ? " · " + flags.join(" · ") : ""}</div>
         <div class="io">${esc(p.overview)}</div>`
      : `<div class="it">${esc(ch.name)}</div><div class="sc">${esc(ch.number)} · no guide information</div>`;
  }
  layout(anim) {
    const tr = anim ? `transform 420ms ${EASE}` : "none";
    const x = `translateX(${-gx(this.t0 - this.T0)}px)`, y = `translateY(${-this.top * G.rowH}px)`;
    this.timeX.style.transition = this.gridX.style.transition = tr;
    this.chY.style.transition = this.gridY.style.transition = tr;
    this.timeX.style.transform = this.gridX.style.transform = x;
    this.chY.style.transform = this.gridY.style.transform = y;
  }
  // slide the 3-hour window so time t is comfortably in view
  showTime(t) {
    const max = this.T0 + G.ahead - G.span;
    if (t < this.t0) this.t0 = Math.floor(t / HALF) * HALF;
    else if (t >= this.t0 + G.span - HALF) this.t0 = Math.floor(t / HALF) * HALF - HALF;
    this.t0 = clamp(this.t0, this.T0, max);
  }
  key(k) {
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
      el("div", "alb-head zs", `<div class="an">${esc(p ? p.title : ch.name)}</div><div class="sc">${
        [`${esc(ch.number)} ${esc(ch.name)}`, p ? `${clock12(p.start)} – ${clock12(p.end)}` : "", when, watching ? "watching" : ""].filter(Boolean).join(" · ")}</div>`));
    // Emby's guide pictures are usually portrait posters; the frame takes the picture's own shape
    // (portrait unless Emby says it's wide), and corrects itself once the picture has loaded
    r.classList.toggle("portrait", !!(p && p.img && !(p.aspect > 1)));
    const pic = el("div", "pg-art flip");
    pic.innerHTML = p && p.img ? imgTag(p.img) : ch.img ? imgTag(ch.img, "logo") : `<div class="num">${esc(ch.number)}</div>`;
    const im = pic.querySelector("img:not(.logo)");
    if (im) im.addEventListener("load", () => r.classList.toggle("portrait", im.naturalWidth < im.naturalHeight));
    r.append(pic);
    const info = el("div", "vid-info pg-info");
    if (p && p.ep) info.append(el("div", "pg-ep t", esc(p.ep)));
    info.append(el("div", "overview t", esc((p && p.overview) || "no description.")));
    const flags = p ? [p.isNew ? "new" : "", p.isLive ? "live" : "", p.isMovie ? "movie" : "", ...(p.genres || []).slice(0, 3)].filter(Boolean) : [];
    if (flags.length) info.append(el("div", "genres t", esc(flags.join(" · ").toLowerCase())));
    const btns = el("div", "btn-row t");
    const list = [["watch", onNow || !p || watching ? "watch" : `watch ${ch.name} now`]];
    if (watching) list.push(["stop", "stop"]);
    list.push(["back", "back"]);
    this.btnEls = list.map(([id, label]) => { const b = el("div", "btn", esc(label)); b.dataset.id = id; return b; });
    btns.append(...this.btnEls); info.append(btns);
    r.append(info);
    this.paint();
    return r;
  }
  paint() { this.btnEls.forEach((b, i) => b.classList.toggle("focus", i === this.f)); }
  bg() { return { src: (this.p && this.p.img) || null, opacity: 0.3 }; }
  key(k) {
    if (k === "left" || k === "right") { this.f = clamp(this.f + (k === "left" ? -1 : 1), 0, this.btnEls.length - 1); this.paint(); return true; }
    if (k === "ok") {
      const id = this.btnEls[this.f].dataset.id;
      if (id === "back") { back(); return true; }
      if (id === "stop") { Live.stop(); toast("stopped " + this.ch.name); back(); return true; }
      if (!Emby.connected) { toast("sign in to emby in settings to watch live tv"); return true; }
      go(new LivePage(this.guide, this.guide.channels.indexOf(this.ch)), { replace: true }); // Back from the TV returns to the guide
      return true;
    }
    return false;
  }
}

/* ============ live tv engine ============
   The video lives in its own layer (#vlayer) under the menus, so it keeps playing while you browse:
   - "full":   the TV screen itself
   - "behind": full screen behind the menus, dimmed so they stay readable
   - "corner": a small window in the lower right, above the menus
   Which background style is used is a setting (settings -> tv behind menus). */
const Live = {
  active: false, guide: null, i: 0, gen: 0, hls: null, stream: null, statusText: "", recovered: false,
  get ch() { return this.guide && this.guide.channels ? this.guide.channels[this.i] : null; },
  isOn(ch) { return this.active && !!ch && !!this.ch && this.ch.id === ch.id; }, // match by id: each guide visit loads fresh channel objects
  get bgMode() { try { return localStorage.getItem("mc.bgVideo") || "behind"; } catch { return "behind"; } },
  set bgMode(v) { try { localStorage.setItem("mc.bgVideo", v); } catch {} this.place(); },
  init() {
    this.layer = el("div", "vlayer off"); this.layer.id = "vlayer";
    this.video = el("video", "lv-video"); this.video.playsInline = true;
    Volume.video = this.video; Volume.apply();
    this.video.classList.add("main");
    Dual.video = el("video", "lv-video side"); Dual.video.playsInline = true; Dual.video.muted = true;
    this.layer.append(this.video, Dual.video, el("div", "vl-scrim"));
    $stage.insertBefore(this.layer, $pages);
    this.chip = el("div", "vchip"); $stage.append(this.chip);
    // both pictures report in; which one is "main" can swap (picture in picture)
    for (const v of [this.video, Dual.video]) {
      v.addEventListener("playing", () => { if (v === this.video) { this.setStatus(""); emitLive("playing"); } else Dual.status(""); });
      v.addEventListener("waiting", () => { if (v === this.video) this.setStatus("buffering…"); else Dual.status("buffering…"); });
    }
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
    this.guide = guide; this.i = i;
    const gen = ++this.gen, ch = this.ch;
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
    this.stream = info;
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
  const report = (hls, text) => { if (hls && hls === Live.hls) Live.setStatus(text); else if (hls && hls === Dual.hls) Dual.status(text); };
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
  if (v === Live.video) Live.setStatus("this browser can't play live tv streams"); else Dual.status("this browser can't play live tv streams");
  return null;
}

/* ============ picture in picture (two channels side by side) ============
   Like the old Zune hub: the pip button in the player controls (or "add <channel>" by voice) moves
   the picture to the right half and lists the channels on the left; pick one and it plays there.
   - ← / → choose which side you hear (it gets a frame)
   - Enter or Back: keep the side you're hearing full screen; the other one closes
   - next / previous change the channel on the side you're hearing */
const Dual = {
  on: false, mode: null, i: -1, audio: "main", gen: 0, hls: null, stream: null, video: null, list: null, statusText: "",
  get chans() { return (Live.guide && Live.guide.channels) || []; },
  get ch() { return this.chans[this.i] || null; },
  page() { const p = top(); return p instanceof LivePage && p.el ? p : null; },
  box() { const p = this.page(); return p ? p.q(".lv-dual") : null; },
  pick(focus) {
    if (this.on || !Live.active || !this.page()) return false;
    if (this.chans.length < 2) { toast("there's only one channel"); return false; }
    this.on = true; this.mode = "pick"; this.audio = "main";
    Live.layer.classList.add("dual"); // the picture glides over to the right half
    const n = this.chans.length;
    this.renderPick(focus != null ? focus : (Live.i + 1) % n);
    this.hint("↑ ↓ choose a channel · enter adds it · back cancels");
    return true;
  },
  renderPick(focus) {
    const box = this.box(); if (!box) return;
    const now = Date.now(), g = Live.guide;
    const row = (ch, i) => {
      const p = g && g.progs && g.progs.has(ch.id) ? g.progAt(ch, now) : null;
      const on = p && p.start <= now && p.end > now ? p.title : "";
      return el("div", "r-dual" + (i === Live.i ? " main" : ""),
        `<span class="n">${esc(ch.number)}</span><div class="tx"><div class="t1 caps">${esc(ch.name)}</div><div class="t2 sc">${i === Live.i ? "watching on the right" : esc(on)}</div></div>`);
    };
    this.list = List({ items: this.chans, itemH: 96, height: 768, row, focus });
    const pickEl = el("div", "lv-pick");
    pickEl.append(el("div", "lv-pick-h sc", "picture in picture"), this.list.el);
    box.querySelector(".lv-pick")?.remove();
    box.prepend(pickEl);
    slideIn([pickEl], -1, { dist: 120, dur: 420 });
  },
  choose(i) {
    if (i === Live.i) { toast("pick a different channel"); return false; }
    this.mode = "play"; this.i = i;
    const box = this.box(), pickEl = box && box.querySelector(".lv-pick");
    if (pickEl) slideOut([pickEl], -1, { dist: 120, dur: 240 }).then(() => pickEl.remove());
    Live.layer.classList.add("dual-play");
    this.setAudio("main");
    this.tune(i);
    this.hint("← → choose the sound · enter keeps that side full screen");
    return true;
  },
  async tune(i) {
    this.i = i;
    this.releaseSide(); // (this also cancels a tune that's still on its way)
    const gen = this.gen, ch = this.ch;
    this.status(`tuning ${ch.number} ${ch.name}…`);
    let info;
    try { info = await Emby.liveStream(ch.id); }
    catch (e) { if (gen === this.gen) this.status("couldn't tune — " + lower(e.message)); return; }
    if (gen !== this.gen || this.mode !== "play") { Emby.stopStream(info); return; }
    this.stream = info;
    this.hls = playStream(this.video, info);
    this.setAudio(this.audio);
  },
  setAudio(which) {
    this.audio = which;
    Live.video.muted = which !== "main";
    this.video.muted = which !== "side";
    this.video.volume = Live.video.volume;
    Live.video.classList.toggle("aud", which === "main");
    this.video.classList.toggle("aud", which === "side");
    this.tags();
  },
  status(t) { this.statusText = t; this.tags(); },
  // small labels over each half: channel, and ♪ on the one you're hearing
  tags() {
    const box = this.box(); if (!box) return;
    let tg = box.querySelector(".lv-tags");
    if (this.mode !== "play") { if (tg) tg.remove(); return; }
    if (!tg) { tg = el("div", "lv-tags", `<div class="lv-tag l"></div><div class="lv-tag r"></div>`); box.append(tg); }
    const m = Live.ch, s = this.ch;
    tg.querySelector(".l").innerHTML = s ? `${this.audio === "side" ? "♪ " : ""}<b>${esc(s.number)}</b> ${esc(s.name)}${this.statusText ? ` · ${esc(this.statusText)}` : ""}` : "";
    tg.querySelector(".r").innerHTML = m ? `${this.audio === "main" ? "♪ " : ""}<b>${esc(m.number)}</b> ${esc(m.name)}` : "";
  },
  hint(text) {
    const box = this.box(); if (!box) return;
    let h = box.querySelector(".lv-dhint");
    if (!h) { h = el("div", "lv-dhint sc"); box.append(h); }
    h.textContent = text;
    h.getAnimations().forEach(a => a.cancel());
    h.animate([{ opacity: 0 }, { opacity: 1, offset: .08 }, { opacity: 1, offset: .85 }, { opacity: 0 }], { duration: 5000, fill: "forwards" });
  },
  // leave picture in picture, keeping one side full screen ("main" = the right, "side" = the left)
  exit(keep = "main") {
    if (!this.on || this.mode === "leaving") return;
    if (this.mode === "pick") return this.cancel();
    if (keep === "side" && !this.stream) keep = "main"; // the left one never got going
    this.mode = "leaving";
    const layer = Live.layer;
    layer.classList.remove("dual-play");
    if (keep === "side") layer.classList.add("keep-side");
    else layer.classList.remove("dual"); // the right side widens back, the left fades away
    this.box()?.querySelector(".lv-tags")?.remove();
    setTimeout(() => {
      if (keep === "side") this.swap();
      this.finish();
    }, 440);
  },
  cancel() {
    const box = this.box(), pickEl = box && box.querySelector(".lv-pick");
    this.mode = "leaving";
    Live.layer.classList.remove("dual");
    if (pickEl) slideOut([pickEl], -1, { dist: 120, dur: 260 }).then(() => pickEl.remove());
    setTimeout(() => this.finish(), 300);
  },
  // the left picture becomes the main one without restarting it (the two players trade places)
  swap() {
    const a = Live.video, b = this.video;
    [Live.hls, this.hls] = [this.hls, Live.hls];
    [Live.stream, this.stream] = [this.stream, Live.stream];
    Live.video = b; this.video = a;
    b.classList.replace("side", "main"); a.classList.replace("main", "side");
    Volume.video = b; b.muted = false; Volume.apply();
    Live.i = this.i;
    const p = this.page(); if (p) p.i = this.i;
  },
  finish(quiet) {
    this.releaseSide();
    Live.layer.classList.remove("dual", "dual-play", "keep-side");
    Live.video.muted = false; Live.video.classList.remove("aud"); this.video.classList.remove("aud");
    this.on = false; this.mode = null; this.i = -1; this.list = null; this.statusText = "";
    const box = this.box(); if (box) box.innerHTML = "";
    const p = this.page(); if (p && !quiet) { p.fill(); p.banner(); }
    Live.updateChip();
  },
  releaseSide() {
    this.gen++;
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    const v = this.video; v.pause(); v.removeAttribute("src"); v.srcObject = null; v.load();
    if (this.stream) { Emby.stopStream(this.stream); this.stream = null; }
  },
  // straight away, no animation (tv stopped, or the player screen left)
  close() {
    if (!this.on) return;
    this.mode = "leaving";
    this.finish(true);
  },
  key(k) {
    if (this.mode === "pick") {
      if (k === "up" || k === "down") this.list.move(k === "up" ? -1 : 1);
      else if (k === "ok") this.choose(this.list.index);
      else if (k === "back") this.cancel();
      return true;
    }
    if (this.mode === "play") {
      if (k === "left" || k === "right") this.setAudio(k === "left" ? "side" : "main");
      else if (k === "ok" || k === "back") this.exit(this.audio);
      return true;
    }
    return true; // mid-animation
  },
  // next / previous: change the channel on the side you're hearing
  mediaKey(k, page) {
    if (k === "stop") return false;
    if (this.mode !== "play") return true;
    const n = this.chans.length, d = k === "next" ? 1 : -1;
    if (this.audio === "side") {
      let j = (this.i + d + n) % n; if (j === Live.i) j = (j + d + n) % n;
      this.tune(j);
    } else {
      let j = (Live.i + d + n) % n; if (j === this.i) j = (j + d + n) % n;
      page.i = j; page.chnum(page.ch.number); Live.tune(Live.guide, j);
    }
    this.tags();
    return true;
  },
};

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
  ["info", "info", `<svg viewBox="0 0 24 24"><path d="M11 10h2v7h-2zm0-3h2v2h-2z"/></svg>`],
  ["dual", "pip", `<svg viewBox="0 0 24 24"><path d="M2 6h9v12H2zm11 0h9v12h-9zM4 8v8h5V8z"/></svg>`], // picture in picture
];
const PLAY_BTN = PLAYER_BUTTONS.findIndex(b => b[0] === "play");

class LivePage extends Page {
  constructor(guide, i) { super(); this.guide = guide; this.i = Math.max(0, i); this.mode = "hidden"; this.bi = PLAY_BTN; this.hideGen = 0; }
  get ch() { return this.guide.channels[this.i]; }
  bg() { return { opacity: 0 }; }
  render() {
    const r = el("div", "live-page");
    r.innerHTML = `<div class="lv-status"></div><div class="lv-dual"></div>
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
    if (Dual.on) { Dual.tags(); return; } // two pictures: no banner over them
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
    this.q(".lv-title").textContent = p ? p.title : ch.name;
    const where = lag ? `${fmt(lag)} behind live` : "live";
    this.q(".lv-sub").textContent = [p && p.ep, where, Live.video.paused && Live.active ? "paused" : ""].filter(Boolean).join(" · ");
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
  }

  // ----- showing / hiding (with the Zune-style motion) -----
  textEls() { return [".lv-ch", ".lv-title", ".lv-sub", ".lv-times", ".lv-osd .lv-bar"].map(s => this.q(s)); }
  setMode(mode) {
    const prev = this.mode, osd = this.q(".lv-osd");
    this.mode = mode;
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
    this.fill();
  }
  // skip back / ahead 30 seconds within what the server has buffered; past "now" snaps back to live
  skip(dir) {
    const v = Live.video, r = v.seekable;
    if (!r || !r.length || r.end(r.length - 1) - r.start(0) < 5) { toast("can't skip on this channel"); return; }
    const start = r.start(0), end = r.end(r.length - 1);
    let t = v.currentTime + dir * 30;
    if (t >= end - 4) { t = end - 1; this.glyph("live"); }
    else if (t < start) { t = start; this.glyph("start"); }
    else this.glyph(dir < 0 ? "−30" : "+30");
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
    this.video = el("video", "vod-video"); this.video.playsInline = true;
    r.prepend(this.video);
    return r;
  }
  async mounted() {
    Live.stop();
    if (Player.playing) Player.toggle(); // music pauses while a movie plays
    const v = this.video;
    Volume.apply();
    this.status("starting…");
    v.addEventListener("playing", () => { this.status(""); if (this.mode !== "hidden") this.fill(); });
    v.addEventListener("waiting", () => this.status("buffering…"));
    v.addEventListener("ended", () => this.finished());
    v.addEventListener("error", () => this.status("this couldn't be played — " + lower((v.error && v.error.message) || "unknown problem")));
    let info;
    try { info = await Emby.videoStream(this.v.id); }
    catch (e) { if (this.el) this.status("couldn't start this — " + lower(e.message)); return; }
    if (!this.el) return;
    this.info = info;
    if (info.hls && window.Hls && Hls.isSupported()) {
      this.hls = new Hls({ startPosition: this.from || -1, xhrSetup: (xhr, url) => { const u = info.withKey(url); if (u !== url) xhr.open("GET", u, true); } });
      this.hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) this.status("the stream stopped — " + lower(String(d.details || "").replace(/([a-z])([A-Z])/g, "$1 $2"))); });
      this.hls.loadSource(info.url);
      this.hls.attachMedia(v);
    } else {
      v.src = info.url;
      if (this.from) v.addEventListener("loadedmetadata", () => { v.currentTime = this.from; }, { once: true });
    }
    v.play().catch(() => {});
    Emby.report("start", info, this.from, false);
    this.reportTimer = setInterval(() => Emby.report("progress", info, v.currentTime, v.paused), 10000);
    this.banner();
  }
  unmount() {
    clearInterval(this.reportTimer);
    const v = this.video;
    if (this.info && !this.done) Emby.report("stop", this.info, v.currentTime, true);
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    v.pause(); v.removeAttribute("src"); v.load();
    super.unmount();
  }
  leave() { return done(this.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" })); }
  live() {}
  get dur() { const d = this.video.duration; return isFinite(d) && d > 0 ? d : (this.info && this.info.dur) || this.v.runtime || 0; }
  fill() {
    if (!this.el) return;
    const v = this.v, ep = v.type === "Episode", pos = this.video.currentTime || 0, d = this.dur;
    this.q(".lv-ch").textContent = ep ? (v.seriesName || "tv shows") : v.home ? ["home video", homeDate(v)].filter(Boolean).join("  ") : ["movie", v.year].filter(Boolean).join("  ");
    this.q(".lv-title").textContent = v.title;
    this.q(".lv-sub").textContent = [ep ? `season ${v.season || "?"} · episode ${v.episode || "?"}` : v.rating, this.video.paused && this.info ? "paused" : ""].filter(Boolean).join(" · ");
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
  press(id) {
    if (id === "play") return this.togglePause();
    if (id === "rw" || id === "ff") return this.seek(id === "ff" ? 30 : -10);
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
    if (top() === this) back();
  }
  playKey() { this.togglePause(); return true; }
  skip(dir) { this.seek(dir > 0 ? 30 : -10); } // (voice: "skip ahead / back")
  changeChannel() {}
  mediaKey(k) {
    if (k === "stop") { back(); return true; }
    if (k === "next" || k === "prev") { this.seek(k === "next" ? 30 : -10); return true; }
    return false;
  }
  key(k) {
    if (k === "back") {
      if (this.infoOpen()) { this.q(".lv-osd").classList.remove("info"); this.arm("osdHide"); return true; }
      if (this.mode === "controls") { this.setMode("hidden"); return true; }
      return false; // leave: the movie stops and Emby keeps your place
    }
    if (this.mode === "controls") {
      if (k === "left" || k === "right") this.focusBtn(k === "left" ? -1 : 1);
      else if (k === "ok") this.press(this.btnEls[this.bi].dataset.id);
      if (this.mode === "controls" && !this.infoOpen()) this.arm("osdHide");
      return true;
    }
    if (k === "ok") { this.bi = VOD_PLAY; this.controls(); return true; }
    if (k === "left" || k === "right") { this.seek(k === "right" ? 30 : -10); return true; }
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
    ],
  },
  {
    name: "playback",
    options: [
      { label: "music info hides after", values: () => SECONDS([0, 3, 5, 8, 10, 15]), get: () => Prefs.get("npHide"), set: v => Prefs.set("npHide", v) },
      { label: "music screensaver", values: () => [[0, "off"], [30, "after 30 seconds"], [60, "after 1 minute"], [120, "after 2 minutes"], [300, "after 5 minutes"]], get: () => Prefs.get("saver"), set: v => { Prefs.set("saver", v); Saver.poke(); } },
      { label: "album art when info hides", values: () => [["hide", "hide it"], ["center", "move to the middle"]], get: () => Prefs.get("npArt"), set: v => Prefs.set("npArt", v) },
      { label: "live tv info hides after", values: () => SECONDS([0, 3, 5, 8, 10]), get: () => Prefs.get("liveHide"), set: v => Prefs.set("liveHide", v) },
      { label: "player controls hide after", values: () => SECONDS([0, 3, 5, 8, 10, 15]), get: () => Prefs.get("osdHide"), set: v => Prefs.set("osdHide", v) },
      { label: "guide enter", values: () => [["info", "show info first"], ["tune", "tune right away"]], get: () => Prefs.get("guideOk"), set: v => Prefs.set("guideOk", v) },
      { label: "music volume", values: () => [100, 80, 60, 40].map(n => [n, `${n}%`]), get: () => Prefs.get("musicVol"), set: v => { Prefs.set("musicVol", v); Volume.apply(); } },
    ],
  },
  { name: "radio", build: "radio" },
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
    const build = { emby: () => this.buildEmby(), menu: () => this.buildMenu(), radio: () => this.buildRadio(), apps: () => this.buildApps() };
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
  buildRadio() {
    const form = el("div", "form"); this.body.append(form);
    if (this.vals.radioKey === undefined) this.vals.radioKey = Prefs.get("radioKey") || "";
    this.makeField({ id: "radioKey", label: "listen key", ph: "your premium listen key", secret: true }, form);
    const btns = this.makeButtons(form, [{ id: "saveRadio", label: "save" }]);
    this.statusEl = el("div", "status t"); form.append(this.statusEl);
    form.append(el("div", "set-note t", "one premium listen key works for di.fm, radiotunes, jazzradio, rockradio, classical radio and zenradio. find it on any of those sites under player settings → hardware player."));
    this.setStatus(Radio.key ? "a listen key is saved" : "no listen key yet", Radio.key ? "ok" : "");
    return [...this.rows, ...btns];
  }
  buildApps() {
    const form = el("div", "form"); this.body.append(form);
    this.vals.ytPath = this.vals.ytPath || "";
    const field = this.makeField({ id: "ytPath", label: "vacuumtube.exe location (for youtube)", ph: "e.g. C:\\Users\\you\\AppData\\Local\\Programs\\VacuumTube\\VacuumTube.exe" }, form);
    const btns = this.makeButtons(form, [{ id: "saveYt", label: "save" }, { id: "testYt", label: "open youtube" }]);
    this.statusEl = el("div", "status t"); form.append(this.statusEl);
    form.append(el("div", "set-note t", "youtube opens in the separate vacuumtube app, full screen. this needs the app started with “Start Media Center”, which runs a small helper on this pc."));
    this.setStatus("checking…");
    Apps.status().then(st => {
      if (!this.el || !this.statusEl || SETTINGS_TABS[this.tab].build !== "apps") return;
      if (st.server === false) return this.setStatus("the helper isn't running — start the app with “Start Media Center”", "err");
      if (st.path && !this.vals.ytPath) { this.vals.ytPath = st.path; field.input.value = st.path; }
      this.setStatus(st.ready ? "ready" : "not set up yet", st.ready ? "ok" : "");
    });
    // voice assistant: the helper starts it (and its mic listener) along with the media center
    form.classList.add("col1");
    const vform = el("div", "form col2"); this.body.append(vform);
    this.vals.vaPath = this.vals.vaPath || "";
    const vfield = this.makeField({ id: "vaPath", label: "voice assistant folder", ph: "the folder with app.py, e.g. C:\\assistant" }, vform);
    const vbtns = this.makeButtons(vform, [{ id: "saveVa", label: "save" }, { id: "startVa", label: "start it now" }]);
    this.vaStatusEl = el("div", "status t"); vform.append(this.vaStatusEl);
    vform.append(el("div", "set-note t", "once this is set, “Start Media Center” also starts your voice assistant and its mic listener, in minimized windows. if they're already running, it leaves them alone."));
    this.vaStatus("checking…");
    Apps.call("/apps/assistant").then(st => {
      if (!this.el || !this.vaStatusEl || SETTINGS_TABS[this.tab].build !== "apps") return;
      if (st.server === false) return this.vaStatus("the helper isn't running — start the app with “Start Media Center”", "err");
      if (st.path && !this.vals.vaPath) { this.vals.vaPath = st.path; vfield.input.value = st.path; }
      this.vaStatus(st.running ? "running" : st.ready ? "set up — not running right now" : "not set up yet", st.running ? "ok" : "");
    });
    return [...this.rows.slice(0, 1), ...btns, vfield, ...vbtns];
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
      else if (it.b.id === "saveYt") this.saveYouTube();
      else if (it.b.id === "testYt") Apps.launch();
      else if (it.b.id === "saveVa") this.saveAssistant();
      else if (it.b.id === "startVa") this.startAssistant();
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
      <div class="np-back t">${ICON.back}</div>
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
    if (this.bgArtist === t.artist) return;
    this.bgArtist = t.artist;
    const wrap = this.q(".np-bg"), img = el("img");
    img.alt = ""; img.style.opacity = 0;
    img.onerror = () => { img.onerror = null; img.src = Art.photo(t.artist.name, t.artist.hue); };
    img.src = artistPhoto(t.artist);
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
  if (Saver.on) { e.preventDefault(); Saver.hide(); return; } // the first press only wakes the screen
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
  if (k === "play") return Live.active ? Live.togglePause() : Player.toggle();
  if ((k === "next" || k === "prev" || k === "stop") && top().mediaKey && top().mediaKey(k)) return; // e.g. live tv: change channel / stop
  if (k === "stop") return Live.active ? Live.stop() : Player.stop();
  if (k === "next") return Player.next();
  if (k === "prev") return Player.prev();
  if (top().key(k, repeat)) return;
  if (k === "back") back();
}
function idle() {
  busy = false;
  if (pending) { const k = pending; pending = null; handle(k, false); }
}

/* ============ clock ============ */
const $clock = document.getElementById("clock");
function clock() {
  const d = new Date();
  $clock.textContent = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  settings: "settings", setup: "settings", youtube: "youtube",
  nowplaying: "player", fullscreen: "player", player: "player",
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
  g.channels = chans;
  await settled();
  go(new LivePage(g, chans.indexOf(ch)), { replace: top() instanceof LivePage });
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
  throw new Error(`unknown action ${action}`);
}

const RPC = {
  "JSONRPC.Ping": () => "pong",
  "GUI.ActivateWindow": async p => {
    const name = p.window || p.windowname || p.section || p.view || "";
    const w = WINDOWS[norm(name)];
    if (!w) throw new Error(`unknown window ${name}`);
    if (w === "home") await goHome();
    else if (w === "youtube") await Apps.launch();
    else if (w === "player") { if (!(await showPlayer())) throw new Error("nothing is playing"); }
    else if (w === "live") { if (Live.active) await showPlayer(); else await openSection("tv guide"); }
    else await openSection(w);
    return { window: w };
  },
  "Input.ExecuteAction": async p => ({ ok: await runAction(p.action || "") }),
  "Player.GetItem": () => nowPlayingItem(),
  "Player.PlayPause": async () => { await settled(); handle("play", false); return { playing: Live.active ? !Live.video.paused : Player.playing }; },
  "Player.Stop": async () => {
    Live.stop();   // the tv screen and the now playing screen close themselves when playback stops
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
  // picture in picture, same answers as the old hub
  "Player.AddDualChannel": async p => {
    const q = String(p.channel || p.query || "").trim();
    if (!q) return { error: "Which channel?" };
    if (!Live.active) { const ch = await tuneChannel(q); return { ok: true, channel: ch.name, mode: "tuned" }; }
    const idx = dualChannelIndex(q);
    if (idx < 0) return { error: "Channel not found: " + q };
    const name = Live.guide.channels[idx].name;
    if (idx === Live.i && !(Dual.mode === "play" && Dual.audio === "side")) return { error: "Already watching that channel" };
    if (Dual.mode === "play") {
      if (idx === Dual.i) return { ok: true, channel: name, mode: "already" };
      Dual.tune(idx); return { ok: true, channel: name, mode: "swap" };
    }
    if (Dual.mode === "pick") { Dual.choose(idx); return { ok: true, channel: name, mode: "added" }; }
    if (Dual.mode === "leaving") await wait(500);
    await showPlayer(); await settled();
    const pg = top(); if (pg instanceof LivePage) pg.setMode("hidden");
    if (!Dual.pick(idx) || !Dual.choose(idx)) return { error: "Could not add channel." };
    return { ok: true, channel: name, mode: "added" };
  },
  "Player.RemoveDualChannel": async p => {
    if (!Dual.on) return { error: "Not in dual view" };
    if (Dual.mode === "pick") { Dual.cancel(); return { ok: true, removed: "pick" }; }
    if (Dual.mode !== "play") { Dual.close(); return { ok: true, removed: "dual" }; }
    const q = String(p.channel || "").trim();
    if (!q) { Dual.exit("main"); return { ok: true, removed: "secondary" }; }
    const idx = dualChannelIndex(q);
    if (idx < 0) return { error: "Channel not found: " + q };
    const name = Live.guide.channels[idx].name;
    if (idx === Dual.i) { Dual.exit("main"); return { ok: true, removed: name, kept: "primary" }; }
    if (idx === Live.i) { Dual.exit("side"); return { ok: true, removed: name, kept: "secondary" }; }
    return { error: "That channel is not in dual view" };
  },
  "Player.ExitDualView": async p => {
    if (!Dual.on) return { ok: true, kept: "primary" };
    const keep = p.keep === "secondary" ? "side" : "main";
    const i = keep === "side" ? Dual.i : Live.i;
    Dual.exit(keep);
    return { ok: true, kept: keep === "side" ? "secondary" : "primary", playIndex: i };
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
function dualChannelIndex(q) {
  const chans = (Live.guide && Live.guide.channels) || [];
  const ch = chans.find(c => c.number && norm(c.number) === norm(q)) || bestMatch(chans, q, c => c.name);
  return ch ? chans.indexOf(ch) : -1;
}
RPC["UI.ActivateView"] = RPC["GUI.ActivateWindow"];

// keeps asking the helper for the next voice command (long-poll), runs it and sends back the answer
const VoiceLink = {
  async start() {
    if (location.protocol === "file:") return; // opened directly: no helper, no voice
    const H = { "X-Media-Center": "1" };
    for (;;) {
      let cmd;
      try {
        const r = await fetch("/jsonrpc/poll", { headers: H, cache: "no-store" });
        if (!r.ok) { await wait(3000); continue; }
        cmd = await r.json();
      } catch { await wait(3000); continue; }
      if (!cmd || cmd.id == null) continue;
      if (!/^(JSONRPC\.Ping|Player\.GetItem|Application\.GetProperties|PVR\.GetChannels|Player\.GetLyrics)$/.test(cmd.method)) { Saver.poke(); Saver.hide(); } // a voice command wakes the screen
      let reply;
      try {
        const fn = RPC[cmd.method];
        if (!fn) throw new Error(`unknown command ${cmd.method}`);
        reply = { id: cmd.id, result: await fn(cmd.params || {}) };
      } catch (e) {
        reply = { id: cmd.id, error: { code: -32000, message: lower(e.message || String(e)) } };
      }
      fetch("/jsonrpc/result", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(reply) }).catch(() => {});
    }
  },
};

// keeps the helper's copy of the tv guide fresh, so "what's on tonight" works by voice
const GuideFeed = {
  async push() {
    if (location.protocol === "file:" || !Emby.connected) return { count: 0 };
    const chans = await Emby.channels();
    const from = Date.now() - HOUR, to = Date.now() + 12 * HOUR, programs = [];
    for (let i = 0; i < chans.length; i += 60) {
      const batch = await Emby.programs(chans.slice(i, i + 60).map(c => c.id), from, to).catch(() => []);
      batch.forEach(p => programs.push({
        Id: p.id, ChannelId: p.channelId, Name: p.title, EpisodeTitle: p.ep, Overview: p.overview,
        Genres: [...(p.genres || []), ...(p.isMovie ? ["Movie"] : [])],
        StartDate: new Date(p.start).toISOString(), EndDate: new Date(p.end).toISOString(),
      }));
    }
    const body = { channels: chans.map(c => ({ Id: c.id, Name: c.name, ChannelNumber: c.number })), programs };
    await fetch("/guide/cache", { method: "POST", headers: { "X-Media-Center": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { count: programs.length };
  },
  start() {
    if (location.protocol === "file:") return;
    const run = () => this.push().catch(() => {});
    setTimeout(run, 8000);              // shortly after start-up
    setInterval(run, 30 * 60 * 1000);   // and every half hour
  },
};

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
      <div class="sv-bio"></div>`;
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
    if (Player.track !== this.shown || Player.track.title !== this.shownTitle) this.fill(); // next song (radio: new song info)
    const d = Player.dur, bar = this.el.querySelector(".sv-bar i");
    bar.style.width = d && !Player.track.live ? Math.min(100, Player.pos / d * 100) + "%" : "0";
  },
  show() {
    this.on = true;
    this.fill();
    this.el.classList.add("on");
    document.documentElement.classList.add("nopointer");
  },
  hide() {
    if (!this.on) return;
    this.on = false; this.poke();
    this.el.classList.remove("on");
    clearInterval(this.picTimer); clearInterval(this.bioTimer);
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
    this.setPics([artistPhoto(t.artist)]);
    clearInterval(this.bioTimer);
    const info = Emby.connected ? await Emby.artistInfo(t.artist) : null;
    if (Player.track !== t || !this.on) return;
    if (info && info.backdrops.length) this.setPics(info.backdrops);
    if (info && info.bio) this.bio(info.bio);
  },
  setPics(list) {
    this.pics = list.filter(Boolean); this.pic = 0;
    clearInterval(this.picTimer);
    this.addPic(this.pics[0]);
    if (this.pics.length > 1) this.picTimer = setInterval(() => { this.pic = (this.pic + 1) % this.pics.length; this.addPic(this.pics[this.pic]); }, 16000);
  },
  addPic(src) { // a new photo fades in over the last one, each drifting a different way
    if (!src) return;
    const bg = this.el.querySelector(".sv-bg"), img = el("img");
    img.alt = ""; img.src = src;
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
window.__app = { Player, stack, go, back, quick, RPC, Volume, Live, Dual, Lyrics, VideoPage, Radio, Saver, artistPage };

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
Saver.init();
loadQuickplay();
go(new Home());
VoiceLink.start(); // voice commands from the assistant
GuideFeed.start(); // guide copy for "what's on" questions
})();
