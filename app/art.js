// Generated stand-in artwork (album covers and soft "artist photos").
// Real covers and artist images will come from Emby later.
window.Art = (() => {
  const cache = new Map();

  function seeded(str) {
    let h = 2166136261;
    for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    let s = (h >>> 0) % 2147483647 || 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return [c, c.getContext("2d")];
  }
  const hue = h => ((h % 360) + 360) % 360;

  function album(al) {
    const key = "al:" + al.id;
    if (cache.has(key)) return cache.get(key);
    const S = 400, r = seeded(al.id + al.title), [c, x] = canvas(S, S), h = al.hue;
    const g = x.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, `hsl(${h},65%,55%)`);
    g.addColorStop(1, `hsl(${hue(h + 50)},70%,16%)`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const style = Math.floor(r() * 3);
    for (let i = 0; i < 7; i++) {
      x.globalAlpha = 0.15 + r() * 0.45;
      x.fillStyle = `hsl(${hue(h + r() * 120 - 60)},${50 + r() * 40}%,${30 + r() * 50}%)`;
      if (style === 0) { x.beginPath(); x.arc(r() * S, r() * S, 20 + r() * 160, 0, 7); x.fill(); }
      else if (style === 1) { x.fillRect(0, r() * S, S, 6 + r() * 60); }
      else { x.save(); x.translate(S / 2, S / 2); x.rotate(r() * Math.PI); x.fillRect(-S, -10 - r() * 40, S * 2, 10 + r() * 80); x.restore(); }
    }
    x.globalAlpha = 1;
    const url = c.toDataURL("image/jpeg", 0.85);
    cache.set(key, url);
    return url;
  }

  function photo(name, h, sat = 1) { // sat: 1 = full colour, lower for greyer glows
    const key = "ph:" + name;
    if (cache.has(key)) return cache.get(key);
    const W = 1600, H = 900, r = seeded(name), [c, x] = canvas(W, H);
    x.fillStyle = `hsl(${h},${40 * sat}%,8%)`; x.fillRect(0, 0, W, H);
    x.filter = "blur(70px)";
    for (let i = 0; i < 10; i++) {
      x.globalAlpha = 0.35 + r() * 0.5;
      x.fillStyle = `hsl(${hue(h + r() * 90 - 45)},${(55 + r() * 35) * sat}%,${22 + r() * 40}%)`;
      x.beginPath();
      x.ellipse(r() * W, r() * H, 140 + r() * 420, 90 + r() * 300, r() * 3, 0, 7);
      x.fill();
    }
    x.filter = "none"; x.globalAlpha = 1;
    const url = c.toDataURL("image/jpeg", 0.82);
    cache.set(key, url);
    return url;
  }

  // Background choices (settings → background). "zune" is the original magenta wallpaper.
  function solid(name, color) {
    const key = "solid:" + name;
    if (cache.has(key)) return cache.get(key);
    const [c, x] = canvas(32, 18);
    x.fillStyle = color; x.fillRect(0, 0, 32, 18);
    const url = c.toDataURL("image/png");
    cache.set(key, url);
    return url;
  }
  // Media Center 2005 feel: deep blue, brighter toward the bottom, with soft light ribbons
  function mediaCenter() {
    const key = "wall:mce";
    if (cache.has(key)) return cache.get(key);
    const W = 1600, H = 900, [c, x] = canvas(W, H);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#04112e"); g.addColorStop(0.55, "#0a2a66"); g.addColorStop(1, "#1d5bb8");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.filter = "blur(50px)";
    [[0.15, 0.95, 700, 120, "rgba(120,190,255,.55)"], [0.7, 0.85, 900, 90, "rgba(90,160,255,.45)"], [0.45, 1.02, 1100, 140, "rgba(170,220,255,.5)"]]
      .forEach(([cx, cy, rx, ry, col]) => { x.fillStyle = col; x.beginPath(); x.ellipse(cx * W, cy * H, rx, ry, -0.12, 0, 7); x.fill(); });
    x.filter = "none";
    const url = c.toDataURL("image/jpeg", 0.85);
    cache.set(key, url);
    return url;
  }
  // Zune HD style: one strong flat colour, darker toward the top, crossed by soft diagonal light streaks
  function streaks(name, top, bottom, light) {
    const key = "wall:" + name;
    if (cache.has(key)) return cache.get(key);
    const W = 1600, H = 900, r = seeded(name), [c, x] = canvas(W, H);
    const g = x.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.filter = "blur(28px)";
    x.save(); x.translate(W / 2, H / 2); x.rotate(-0.42);
    for (let i = 0; i < 6; i++) {
      x.globalAlpha = 0.1 + r() * 0.22;
      x.fillStyle = light;
      x.fillRect(-W, -H * 0.6 + r() * H * 1.2, W * 2, 14 + r() * 90);
    }
    x.restore();
    x.filter = "blur(120px)"; x.globalAlpha = 0.35; x.fillStyle = light; // a broad glow low on the right
    x.beginPath(); x.ellipse(W * 0.78, H * 0.92, 520, 220, -0.3, 0, 7); x.fill();
    x.filter = "none"; x.globalAlpha = 1;
    const url = c.toDataURL("image/jpeg", 0.85);
    cache.set(key, url);
    return url;
  }
  const WALLS = {
    zune: () => photo("home-wallpaper", 322),
    black: () => solid("black", "#000"),
    "media center": mediaCenter,
    // soft colour glows
    sunset: () => photo("wall-sunset", 18),
    forest: () => photo("wall-forest", 140),
    midnight: () => photo("wall-midnight", 245),
    ocean: () => photo("wall-ocean", 188),
    ruby: () => photo("wall-ruby", 352),
    violet: () => photo("wall-violet", 275),
    gold: () => photo("wall-gold", 42),
    rose: () => photo("wall-rose", 332),
    slate: () => photo("wall-slate", 215, 0.25),
    // classic zune hd looks
    "zune orange": () => streaks("zune-orange", "#7a2600", "#ff7a00", "#ffd08a"),
    "zune pink": () => streaks("zune-pink", "#5c0036", "#ec008c", "#ff9ad6"),
    "zune blue": () => streaks("zune-blue", "#00264d", "#0a7ad6", "#9fd8ff"),
    "zune green": () => streaks("zune-green", "#0d3300", "#4caf1a", "#d4ff8a"),
    "zune purple": () => streaks("zune-purple", "#24004a", "#7b2fd0", "#d7b0ff"),
  };
  let wall = "zune";

  return {
    album, photo,
    walls: Object.keys(WALLS),
    setWallpaper(name) { if (WALLS[name]) wall = name; },
    wallpaper: () => WALLS[wall](),
  };
})();
