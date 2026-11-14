// Invented sample library for the look-and-feel demo.
// Later this gets replaced by real data from the Emby server.
window.LIB = (() => {
  let s = 20091; // fixed seed, so the library is identical every time
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const ARTISTS = [
    "aurora vale", "the paper lanterns", "northbound", "mira kade", "static bloom",
    "low tide motel", "juniper & ash", "the glass parade", "kite season", "oren wilde",
    "velvet coast", "hollow pines", "neon harbor", "sundial", "ada flint", "the quiet radios",
  ];
  const GENRES = ["electronic", "indie", "pop", "rock", "ambient", "soul"];
  const A = ["midnight", "paper", "silver", "golden", "quiet", "electric", "broken", "distant", "northern",
    "velvet", "neon", "hollow", "summer", "winter", "glass", "wild", "secret", "slow", "bright", "lost", "satellite"];
  const B = ["lights", "hearts", "river", "signals", "coast", "dreams", "static", "fire", "rooms", "horizon",
    "echoes", "gardens", "weather", "machines", "tides", "stars", "streets", "wires", "ghosts", "radio"];
  const V = ["come", "stay", "run", "fall", "hold", "drift", "wait", "burn", "carry", "follow"];
  const P = ["home", "close", "away", "slow", "on", "under", "with me", "tonight", "the line", "me back"];
  const phrase = () => {
    const r = rnd();
    if (r < 0.55) return pick(A) + " " + pick(B);
    if (r < 0.75) return pick(B);
    return pick(V) + " " + pick(P);
  };

  const artists = ARTISTS.map((name, i) => ({ id: "ar" + i, name, hue: Math.floor(rnd() * 360), genre: pick(GENRES), albums: [] }));
  const albums = [], songs = [];
  for (const ar of artists) {
    const n = int(1, 3);
    for (let k = 0; k < n; k++) {
      const al = {
        id: "al" + albums.length, title: phrase(), artist: ar, year: int(2002, 2012),
        genre: ar.genre, hue: (ar.hue + int(-40, 40) + 360) % 360, tracks: [],
      };
      const tn = int(8, 12);
      for (let t = 0; t < tn; t++) {
        const song = { id: al.id + "t" + t, no: t + 1, title: phrase(), dur: int(150, 300), album: al, artist: ar };
        al.tracks.push(song); songs.push(song);
      }
      ar.albums.push(al); albums.push(al);
    }
  }
  const byText = k => (a, b) => a[k].localeCompare(b[k]);
  artists.sort(byText("name"));
  albums.sort(byText("title"));
  songs.sort(byText("title"));

  const playlists = ["late night drive", "sunday morning", "focus", "favorites", "rainy day", "summer 2009"]
    .map(name => ({ name, tracks: shuffle(songs).slice(0, int(12, 20)) }));
  const genres = GENRES.map(name => ({ name, albums: albums.filter(a => a.genre === name) })).filter(g => g.albums.length);
  const history = shuffle(albums).slice(0, 5);
  const newest = [...albums].sort((a, b) => b.year - a.year).slice(0, 5);

  return { artists, albums, songs, playlists, genres, history, newest };
})();
