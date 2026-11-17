// Talks to the Emby server. Signing in stores only the server address and an access token
// in this browser (never the password).
window.Emby = (() => {
  const KEY = "mc.emby";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  let s = load(); // { server, token, userId, userName, serverName, version }

  let deviceId;
  try {
    deviceId = localStorage.getItem("mc.deviceId");
    if (!deviceId) { deviceId = "mc-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("mc.deviceId", deviceId); }
  } catch { deviceId = "mc-" + Date.now().toString(36); }

  const authHeader = () =>
    `Emby Client="Media Center", Device="Windows", DeviceId="${deviceId}", Version="0.1.0"` +
    (s.userId ? `, UserId="${s.userId}"` : "") + (s.token ? `, Token="${s.token}"` : "");

  // accepts "192.168.1.20:8096", "http://myserver:8096/", "https://emby.example.com"
  function normalize(url) {
    url = String(url || "").trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = "http://" + url;
    return url.replace(/\/+$/, "").replace(/\/emby$/i, "");
  }

  async function req(path, { method = "GET", body, server = s.server } = {}) {
    const headers = { "X-Emby-Authorization": authHeader(), "Accept": "application/json" };
    if (s.token) headers["X-Emby-Token"] = s.token;
    if (body) headers["Content-Type"] = "application/json";
    const r = await fetch(server + "/emby" + path, { method, headers, body: body && JSON.stringify(body) });
    if (!r.ok) { const e = new Error(`server said ${r.status}`); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json().catch(() => null);
  }

  async function reqText(path) {
    const r = await fetch(s.server + "/emby" + path, { headers: { "X-Emby-Authorization": authHeader(), "X-Emby-Token": s.token || "" } });
    return r.ok ? r.text() : null;
  }

  // A song's lyrics: { lines } straight from Emby's lyrics list, or { text } (the raw .lrc / subtitle
  // text, for the app to read), or { files } — where the .lrc might sit next to the song, so the
  // helper can read it when Emby runs on this PC. null when there's nothing to go on.
  async function lyrics(id) {
    try {
      const d = await req(`/Audio/${id}/Lyrics`);
      const list = d && (d.Lyrics || d.lyrics);
      if (Array.isArray(list) && list.length) {
        return { lines: list.map(l => ({ text: String(l.Text || l.text || "").trim(), start: l.Start != null ? l.Start / 1e7 : null })).filter(l => l.text) };
      }
    } catch { /* this server has no lyrics list; look for an .lrc file instead */ }
    let item;
    try { item = await req(`/Users/${s.userId}/Items/${id}?` + Q({ Fields: "MediaSources,Path" })); } catch { return null; }
    let pick = null;
    for (const ms of (item && item.MediaSources) || []) {
      for (const st of ms.MediaStreams || []) {
        if (st.Type !== "Subtitle") continue;
        const path = String(st.Path || "");
        if (String(st.Codec || "").toLowerCase() === "lrc" || /\.lrc$/i.test(path) || (st.IsTextSubtitleStream && path)) { pick = { ms: ms.Id, index: st.Index, path }; break; }
      }
      if (pick) break;
    }
    if (pick) {
      for (const fmt of ["lrc", "srt", "vtt", "txt"]) {
        try {
          const text = await reqText(`/Videos/${id}/${pick.ms}/Subtitles/${pick.index}/Stream.${fmt}`);
          if (text && text.trim()) return { text };
        } catch { /* try the next format */ }
      }
    }
    const files = [pick && pick.path, item && item.Path && item.Path.replace(/\.[^.\\/]+$/, ".lrc")].filter(Boolean);
    return files.length ? { files } : null;
  }

  async function connect(serverInput, username, password) {
    const server = normalize(serverInput);
    if (!server) throw new Error("enter the server address first");
    if (!username) throw new Error("enter your username");
    let info;
    try {
      info = await req("/System/Info/Public", { server });
    } catch (e) {
      throw new Error(e.status ? `found something at ${server}, but it isn't answering like an emby server` : `can't reach a server at ${server}`);
    }
    s = { server };
    let auth;
    try {
      auth = await req("/Users/AuthenticateByName", { method: "POST", body: { Username: username, Pw: password || "" } });
    } catch (e) {
      save();
      throw new Error(e.status === 401 ? "wrong username or password" : `sign-in failed (${e.message})`);
    }
    s = {
      server, token: auth.AccessToken, userId: auth.User.Id, userName: auth.User.Name,
      serverName: info.ServerName || "emby", version: info.Version || "",
    };
    save();
    return s;
  }

  async function libraries() {
    const r = await req(`/Users/${s.userId}/Views`);
    return (r && r.Items || []).map(i => ({ id: i.Id, name: i.Name, type: i.CollectionType || "" }));
  }

  async function signOut() {
    try { if (s.token) await req("/Sessions/Logout", { method: "POST" }); } catch {}
    s = { server: s.server };
    save();
  }

  /* ---------- library ---------- */
  const Q = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  const secs = t => Math.round((t || 0) / 1e7);
  // Emby dates can carry 7 decimal places ("…:00.0000000Z"); trim to milliseconds before parsing
  const date = str => Date.parse(String(str || "").replace(/(\.\d{3})\d+/, "$1"));
  const hashHue = str => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const img = (id, tag, type = "Primary", h = 440) =>
    id && tag ? `${s.server}/emby/Items/${id}/Images/${type}?maxHeight=${h}&tag=${tag}&quality=90&api_key=${encodeURIComponent(s.token || "")}` : null;
  const imgAny = (id, type = "Primary", h = 440) => // no tag: let the server find a picture if it has one
    id ? `${s.server}/emby/Items/${id}/Images/${type}?maxHeight=${h}&quality=90&api_key=${encodeURIComponent(s.token || "")}` : null;
  // Album art can live in several places in Emby: the album's own picture, a picture borrowed from
  // another item, or art embedded in the songs. Collect every candidate; the app tries them in order.
  const artList = (...urls) => [...new Set(urls.filter(Boolean))];
  const FIELDS = "PrimaryImageAspectRatio,ProductionYear,Overview,Genres,OfficialRating,CommunityRating,ChildCount,DateCreated";

  async function items(params) {
    const r = await req(`/Users/${s.userId}/Items?` + Q({ Recursive: true, Fields: FIELDS, EnableUserData: true, ...params }));
    return (r && r.Items) || [];
  }
  const list = r => (Array.isArray(r) ? r : (r && r.Items) || []);

  const artistsOf = cache => (id, name) => {
    name = name || "unknown artist";
    const key = id || name;
    if (!cache.has(key)) cache.set(key, { id, name, hue: hashHue(name), emby: true });
    return cache.get(key);
  };
  const artist = artistsOf(new Map());

  const mapAlbum = i => {
    const a = (i.AlbumArtists && i.AlbumArtists[0]) || {};
    return {
      id: i.Id, title: i.Name || "", year: i.ProductionYear || "", count: i.ChildCount || 0,
      artist: artist(a.Id, i.AlbumArtist || a.Name), hue: hashHue(i.Name || i.Id), emby: true, sortName: i.SortName || "",
      imgs: artList(
        img(i.Id, i.ImageTags && i.ImageTags.Primary),
        img(i.PrimaryImageItemId, i.PrimaryImageTag),
        imgAny(i.Id),
      ),
    };
  };
  const albumCache = new Map();
  const mapTrack = (i, album) => {
    let al = album || albumCache.get(i.AlbumId);
    if (!al) {
      const a = (i.AlbumArtists && i.AlbumArtists[0]) || (i.ArtistItems && i.ArtistItems[0]) || {};
      al = {
        id: i.AlbumId || i.Id, title: i.Album || "", year: i.ProductionYear || "", hue: hashHue(i.Album || i.Id),
        artist: artist(a.Id, i.AlbumArtist || a.Name), emby: true,
        imgs: artList(
          img(i.AlbumId, i.AlbumPrimaryImageTag),
          img(i.Id, i.ImageTags && i.ImageTags.Primary), // art embedded in the song itself
          imgAny(i.AlbumId), imgAny(i.Id),
        ),
      };
      if (i.AlbumId) albumCache.set(i.AlbumId, al);
    } else if (al.emby && i.ImageTags && i.ImageTags.Primary) {
      // album had no picture of its own? the songs' embedded art is a good stand-in
      al.imgs = artList(...(al.imgs || []), img(i.Id, i.ImageTags.Primary));
    }
    const ar = (i.ArtistItems && i.ArtistItems[0]) || {};
    return {
      id: i.Id, no: i.IndexNumber || "", title: i.Name || "", dur: secs(i.RunTimeTicks), album: al,
      artist: ar.Id || (i.Artists && i.Artists[0]) ? artist(ar.Id, (i.Artists && i.Artists[0]) || ar.Name) : al.artist,
      stream: streamUrl(i.Id), emby: true,
    };
  };
  // An artist's biography and backdrop photos, as Emby has them (from the metadata it downloads).
  // Radio artists aren't Emby items: they're looked up in the library by name.
  const infoCache = new Map();
  async function artistInfo(a) {
    if (!a || !a.name || !s.token) return null;
    const key = (a.id || "") + "|" + a.name.toLowerCase();
    if (infoCache.has(key)) return infoCache.get(key);
    const p = (async () => {
      let id = a.id;
      if (!id) {
        const hits = list(await req("/Artists?" + Q({ UserId: s.userId, SearchTerm: a.name, Recursive: true, Limit: 10 })));
        const m = hits.find(x => (x.Name || "").toLowerCase() === a.name.toLowerCase());
        id = m && m.Id;
      }
      if (!id) return null;
      const i = await req(`/Users/${s.userId}/Items/${id}?` + Q({ Fields: "Overview" }));
      const bio = String((i && i.Overview) || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
      const backdrops = ((i && i.BackdropImageTags) || []).map((t, n) =>
        `${s.server}/emby/Items/${id}/Images/Backdrop/${n}?maxHeight=1080&tag=${t}&quality=85&api_key=${encodeURIComponent(s.token)}`);
      return { id, name: i.Name || a.name, bio, backdrops, photo: img(id, i.ImageTags && i.ImageTags.Primary, "Primary", 800) };
    })().catch(() => null);
    infoCache.set(key, p);
    return p;
  }
  /* ---------- home videos & pictures ----------
     Libraries are found by their Emby type ("home videos & photos", "photos"); failing that, by
     name ("home videos", "photos", "pictures"). Their folders are browsed as Emby has them. */
  async function mediaLibs(kind) {
    const views = (await req(`/Users/${s.userId}/Views`)).Items || [];
    const types = kind === "photos" ? ["photos", "homevideos"] : ["homevideos"];
    let hits = views.filter(v => types.includes(v.CollectionType));
    if (!hits.length) {
      const re = kind === "photos" ? /\b(photos?|pictures?)\b/i : /home\s*videos?/i;
      hits = views.filter(v => re.test(v.Name || ""));
    }
    return hits.map(v => ({ id: v.Id, title: v.Name || "", isFolder: true, kind: "folder", hue: hashHue(v.Name || v.Id), emby: true }));
  }
  const mapMedia = i => {
    const folder = !!i.IsFolder;
    const when = date(i.PremiereDate) || date(i.DateCreated) || 0;
    return {
      id: i.Id, type: i.Type, title: i.Name || "", isFolder: folder,
      kind: folder ? "folder" : i.MediaType === "Photo" || i.Type === "Photo" ? "photo" : "video",
      img: img(i.Id, i.ImageTags && i.ImageTags.Primary, "Primary", 480),
      thumb: img(i.Id, i.ImageTags && (i.ImageTags.Thumb || i.ImageTags.Primary), i.ImageTags && i.ImageTags.Thumb ? "Thumb" : "Primary", 360),
      full: i.Type === "Photo" ? `${s.server}/emby/Items/${i.Id}/Images/Primary?maxWidth=1920&maxHeight=1080&quality=90&tag=${(i.ImageTags && i.ImageTags.Primary) || ""}&api_key=${encodeURIComponent(s.token)}` : null,
      when, added: i.DateCreated || "", year: i.ProductionYear || (when ? new Date(when).getFullYear() : ""),
      runtime: secs(i.RunTimeTicks), overview: i.Overview || "", count: i.ChildCount || 0,
      resume: secs(i.UserData && i.UserData.PlaybackPositionTicks), played: !!(i.UserData && i.UserData.Played),
      hue: hashHue(i.Name || i.Id), emby: true, home: true,
    };
  };
  const mediaTypes = kind => kind === "photos" ? { IncludeItemTypes: "Photo" } : { IncludeItemTypes: "Video,Movie,Episode", MediaTypes: "Video" };
  // what's in a folder (or library): its sub-folders and its videos / photos
  async function folder(parentId, kind) {
    const r = await req(`/Users/${s.userId}/Items?` + Q({
      ParentId: parentId, Recursive: false, Fields: FIELDS + ",PremiereDate", EnableUserData: true, SortBy: "SortName",
    }));
    return list(r).map(mapMedia).filter(x => x.kind === "folder" || (kind === "photos" ? x.kind === "photo" : x.kind === "video"));
  }
  // every video / photo in these libraries (newest first when "recent")
  async function everything(libIds, kind, recent) {
    const out = [];
    for (const id of libIds) {
      const r = await req(`/Users/${s.userId}/Items?` + Q({
        ParentId: id, Recursive: true, Fields: FIELDS + ",PremiereDate", EnableUserData: true, ...mediaTypes(kind),
        SortBy: recent ? "DateCreated" : "SortName", SortOrder: recent ? "Descending" : "Ascending", Limit: recent ? 60 : 3000,
      }));
      out.push(...list(r).map(mapMedia));
    }
    if (recent) out.sort((a, b) => Date.parse(b.added || 0) - Date.parse(a.added || 0));
    return recent ? out.slice(0, 60) : out;
  }
  const mapArtist = i => {
    const a = artist(i.Id, i.Name);
    a.img = img(i.Id, i.ImageTags && i.ImageTags.Primary, "Primary", 600);
    a.backdrop = i.BackdropImageTags && i.BackdropImageTags.length ? img(i.Id, i.BackdropImageTags[0], "Backdrop", 1080) : null;
    return a;
  };
  const mapVideo = i => ({
    id: i.Id, type: i.Type, title: i.Name || "", year: i.ProductionYear || "",
    img: img(i.Id, i.ImageTags && i.ImageTags.Primary, "Primary", 480),
    thumb: img(i.Id, i.ImageTags && (i.ImageTags.Thumb || i.ImageTags.Primary), i.ImageTags && i.ImageTags.Thumb ? "Thumb" : "Primary", 300),
    backdrop: i.BackdropImageTags && i.BackdropImageTags.length ? img(i.Id, i.BackdropImageTags[0], "Backdrop", 1080)
      : i.ParentBackdropItemId && i.ParentBackdropImageTags && i.ParentBackdropImageTags.length ? img(i.ParentBackdropItemId, i.ParentBackdropImageTags[0], "Backdrop", 1080) : null,
    overview: i.Overview || "", runtime: secs(i.RunTimeTicks), rating: i.OfficialRating || "",
    score: i.CommunityRating ? Math.round(i.CommunityRating * 10) / 10 : null, genres: i.Genres || [],
    resume: secs(i.UserData && i.UserData.PlaybackPositionTicks), played: !!(i.UserData && i.UserData.Played),
    seriesId: i.SeriesId, seriesName: i.SeriesName || "", episode: i.IndexNumber, season: i.ParentIndexNumber,
    hue: hashHue(i.Name || i.Id), emby: true, sortName: i.SortName || "", added: i.DateCreated || "",
  });
  const mapNamed = i => ({ id: i.Id, name: (i.Name || "").toLowerCase(), count: i.ChildCount || 0, emby: true });

  function streamUrl(id) {
    return `${s.server}/emby/Audio/${id}/universal?` + Q({
      UserId: s.userId, DeviceId: deviceId, api_key: s.token, MaxStreamingBitrate: 140000000,
      Container: "opus,mp3,aac,m4a,m4b,flac,webma,webm,wav,ogg", TranscodingContainer: "aac",
      TranscodingProtocol: "http", AudioCodec: "aac",
    });
  }

  /* ---------- live tv playback ----------
     Asks Emby to open the tuner and hand back a stream the browser can play
     (H.264 video + stereo AAC in HLS; Emby converts live MPEG-2 / AC-3 on the fly). */
  const BROWSER_PROFILE = {
    MaxStreamingBitrate: 40000000, MaxStaticBitrate: 100000000, MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: [{ Container: "mp4,m4v", Type: "Video", VideoCodec: "h264", AudioCodec: "aac,mp3" }],
    TranscodingProfiles: [{
      Container: "ts", Type: "Video", VideoCodec: "h264", AudioCodec: "aac", Context: "Streaming",
      Protocol: "hls", MaxAudioChannels: "2", MinSegments: "1", BreakOnNonKeyFrames: true,
    }],
    ContainerProfiles: [], CodecProfiles: [], SubtitleProfiles: [], ResponseProfiles: [],
  };
  const withKey = url => /[?&]api_key=/.test(url) ? url : url + (url.includes("?") ? "&" : "?") + "api_key=" + encodeURIComponent(s.token);

  // light: a small, low-bitrate stream (about 480p) for the little picture-in-picture windows,
  // so four pictures cost the TV computer and the Emby server about as much as one and a half
  // The normal ceiling is 20 Mbps: well above what H.264 channels use (Frndly / Philo run ~3–8 Mbps, so
  // Emby passes them along untouched), while over-the-air MPEG-2, which Emby must convert, comes out at
  // a sensible size instead of the old 40 Mbps.
  async function liveStream(channelId, { light = false } = {}) {
    const rate = light ? 1500000 : 20000000;
    const r = await req(`/Items/${channelId}/PlaybackInfo?` + Q({
      UserId: s.userId, StartTimeTicks: 0, IsPlayback: true, AutoOpenLiveStream: true, MaxStreamingBitrate: rate,
    }), { method: "POST", body: { DeviceProfile: { ...BROWSER_PROFILE, MaxStreamingBitrate: rate } } });
    if (r && r.ErrorCode) throw new Error(lowerWords(r.ErrorCode));
    const ms = r && r.MediaSources && r.MediaSources[0];
    if (!ms) throw new Error("emby didn't offer a stream for this channel");
    const path = ms.TranscodingUrl || `/Videos/${channelId}/master.m3u8?` + Q({ MediaSourceId: ms.Id, LiveStreamId: ms.LiveStreamId, PlaySessionId: r.PlaySessionId, DeviceId: deviceId, VideoCodec: "h264", AudioCodec: "aac", MaxAudioChannels: 2 });
    const url = withKey(s.server + (path.startsWith("/") ? "" : "/") + path);
    const info = { itemId: channelId, mediaSourceId: ms.Id, liveStreamId: ms.LiveStreamId, playSessionId: r.PlaySessionId, url, withKey };
    req("/Sessions/Playing", { method: "POST", body: { ItemId: channelId, MediaSourceId: ms.Id, LiveStreamId: ms.LiveStreamId, PlaySessionId: r.PlaySessionId, PlayMethod: "Transcode", CanSeek: false } }).catch(() => {});
    return info;
  }
  // tell Emby we're done so it frees the tuner and stops converting
  function stopStream(info) {
    if (!info) return;
    req("/Sessions/Playing/Stopped", { method: "POST", body: { ItemId: info.itemId, MediaSourceId: info.mediaSourceId, LiveStreamId: info.liveStreamId, PlaySessionId: info.playSessionId } }).catch(() => {});
    req("/Videos/ActiveEncodings?" + Q({ DeviceId: deviceId, PlaySessionId: info.playSessionId }), { method: "DELETE" }).catch(() => {});
    if (info.liveStreamId) req("/LiveStreams/Close?" + Q({ LiveStreamId: info.liveStreamId }), { method: "POST" }).catch(() => {});
  }
  /* ---------- movies & episodes ----------
     Plays the file as it is when Edge can (MP4 / WebM with H.264, VP9 or AV1 video and AAC, MP3,
     Opus or FLAC sound). Anything else — 4K HEVC, MKV, TrueHD, DTS… — Emby converts on the fly
     into an HLS stream Edge can play (H.264 + up to 5.1 AAC), only as much as needed: often just
     the sound, with the picture passed through untouched. */
  const VIDEO_PROFILE = {
    MaxStreamingBitrate: 120000000, MaxStaticBitrate: 120000000, MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: [
      { Container: "mp4,m4v", Type: "Video", VideoCodec: "h264,vp9", AudioCodec: "aac,mp3,opus,flac" },
      { Container: "webm", Type: "Video", VideoCodec: "vp8,vp9", AudioCodec: "vorbis,opus" },
    ],
    TranscodingProfiles: [{
      Container: "ts", Type: "Video", VideoCodec: "h264", AudioCodec: "aac", Context: "Streaming",
      Protocol: "hls", MaxAudioChannels: "6", MinSegments: "1", BreakOnNonKeyFrames: true,
    }],
    ContainerProfiles: [], ResponseProfiles: [],
    // Only what Edge reliably decodes goes through untouched: 8-bit H.264 (normal profiles and
    // levels, up to 4K) and 8-bit VP9 up to 1080p. 10-bit H.264, HDR VP9, AV1… Emby converts.
    CodecProfiles: [
      {
        Type: "Video", Codec: "h264", Conditions: [
          { Condition: "LessThanEqual", Property: "VideoBitDepth", Value: "8", IsRequired: false },
          { Condition: "EqualsAny", Property: "VideoProfile", Value: "high|main|baseline|constrained baseline", IsRequired: false },
          { Condition: "LessThanEqual", Property: "VideoLevel", Value: "52", IsRequired: false },
          { Condition: "LessThanEqual", Property: "Width", Value: "3840", IsRequired: false },
        ],
      },
      {
        Type: "Video", Codec: "vp9", Conditions: [
          { Condition: "LessThanEqual", Property: "VideoBitDepth", Value: "8", IsRequired: false },
          { Condition: "LessThanEqual", Property: "Width", Value: "1920", IsRequired: false },
        ],
      },
    ],
    SubtitleProfiles: [{ Format: "vtt", Method: "External" }],
  };
  // convert: true asks Emby to convert no matter what (used when Edge choked on the file as it is)
  async function videoStream(itemId, { convert = false } = {}) {
    const r = await req(`/Items/${itemId}/PlaybackInfo?` + Q({
      UserId: s.userId, IsPlayback: true, AutoOpenLiveStream: true, MaxStreamingBitrate: 120000000,
      EnableDirectPlay: convert ? false : undefined, EnableDirectStream: convert ? false : undefined,
    }), { method: "POST", body: { DeviceProfile: VIDEO_PROFILE } });
    if (r && r.ErrorCode) throw new Error(lowerWords(r.ErrorCode));
    const ms = r && r.MediaSources && r.MediaSources[0];
    if (!ms) throw new Error("emby didn't offer a way to play this");
    let url, hls, method;
    if (ms.TranscodingUrl) { url = ms.TranscodingUrl; hls = true; method = "Transcode"; }
    else {
      url = `/Videos/${itemId}/stream.${(ms.Container || "mp4").split(",")[0]}?` + Q({ Static: true, MediaSourceId: ms.Id, PlaySessionId: r.PlaySessionId, DeviceId: deviceId });
      hls = false; method = "DirectPlay";
    }
    url = withKey(s.server + (url.startsWith("/") ? "" : "/") + url);
    const info = { itemId, mediaSourceId: ms.Id, liveStreamId: ms.LiveStreamId, playSessionId: r.PlaySessionId, url, hls, method, withKey, dur: secs(ms.RunTimeTicks) };
    return info;
  }
  // keep Emby up to date: where you are (for "resume" / "continue watching"), paused or not, finished
  function report(kind, info, pos, paused) {
    if (!info) return;
    const body = {
      ItemId: info.itemId, MediaSourceId: info.mediaSourceId, PlaySessionId: info.playSessionId, LiveStreamId: info.liveStreamId,
      PositionTicks: Math.round((pos || 0) * 1e7), IsPaused: !!paused, PlayMethod: info.method, CanSeek: true,
    };
    const path = kind === "start" ? "/Sessions/Playing" : kind === "stop" ? "/Sessions/Playing/Stopped" : "/Sessions/Playing/Progress";
    req(path, { method: "POST", body }).catch(() => {});
    if (kind === "stop" && info.method === "Transcode") req("/Videos/ActiveEncodings?" + Q({ DeviceId: deviceId, PlaySessionId: info.playSessionId }), { method: "DELETE" }).catch(() => {});
  }
  const lowerWords = code => String(code).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

  const api = {
    // music
    albums: async () => (await items({ IncludeItemTypes: "MusicAlbum", SortBy: "SortName" })).map(mapAlbum),
    newAlbums: async (n = 12) => (await items({ IncludeItemTypes: "MusicAlbum", SortBy: "DateCreated", SortOrder: "Descending", Limit: n })).map(mapAlbum),
    artists: async () => list(await req("/Artists/AlbumArtists?" + Q({ UserId: s.userId, SortBy: "SortName", Recursive: true, Fields: "PrimaryImageAspectRatio" }))).map(mapArtist),
    songs: async () => (await items({ IncludeItemTypes: "Audio", SortBy: "SortName", Limit: 1500 })).map(i => mapTrack(i)),
    playlists: async () => (await items({ IncludeItemTypes: "Playlist", SortBy: "SortName" })).filter(i => !i.MediaType || i.MediaType === "Audio").map(mapNamed),
    playlistTracks: async id => list(await req(`/Playlists/${id}/Items?` + Q({ UserId: s.userId, Fields: FIELDS }))).filter(i => i.Type === "Audio").map(i => mapTrack(i)),
    musicGenres: async () => list(await req("/MusicGenres?" + Q({ UserId: s.userId, SortBy: "SortName", Recursive: true }))).map(mapNamed),
    genreAlbums: async id => (await items({ IncludeItemTypes: "MusicAlbum", GenreIds: id, SortBy: "SortName" })).map(mapAlbum),
    artistAlbums: async id => (await items({ IncludeItemTypes: "MusicAlbum", ArtistIds: id, SortBy: "ProductionYear,SortName", SortOrder: "Descending" })).map(mapAlbum),
    artistSongs: async id => (await items({ IncludeItemTypes: "Audio", ArtistIds: id, SortBy: "Album,ParentIndexNumber,IndexNumber" })).map(i => mapTrack(i)),
    // voice: "play artist bing crosby", "play some christmas music"
    findArtists: async q => list(await req("/Artists?" + Q({ UserId: s.userId, SearchTerm: q, Recursive: true, Limit: 20 }))).map(mapArtist),
    findMusicGenres: async q => list(await req("/MusicGenres?" + Q({ UserId: s.userId, SearchTerm: q, Recursive: true, Limit: 20 }))).map(mapNamed),
    genreSongs: async id => (await items({ IncludeItemTypes: "Audio", GenreIds: id, Limit: 600 })).map(i => mapTrack(i)),
    searchSongs: async q => (await items({ IncludeItemTypes: "Audio", SearchTerm: q, Limit: 300 })).map(i => mapTrack(i)),
    albumTracks: async al => {
      albumCache.set(al.id, al);
      return (await items({ ParentId: al.id, IncludeItemTypes: "Audio", SortBy: "ParentIndexNumber,IndexNumber,SortName" })).map(i => mapTrack(i, al));
    },
    // movies
    movies: async () => (await items({ IncludeItemTypes: "Movie", SortBy: "SortName" })).map(mapVideo),
    newMovies: async (n = 30) => list(await req(`/Users/${s.userId}/Items/Latest?` + Q({ IncludeItemTypes: "Movie", Limit: n, Fields: FIELDS, EnableUserData: true }))).map(mapVideo),
    movieGenres: async () => list(await req("/Genres?" + Q({ UserId: s.userId, IncludeItemTypes: "Movie", Recursive: true, SortBy: "SortName" }))).map(mapNamed),
    genreMovies: async id => (await items({ IncludeItemTypes: "Movie", GenreIds: id, SortBy: "SortName" })).map(mapVideo),
    // tv
    shows: async () => (await items({ IncludeItemTypes: "Series", SortBy: "SortName" })).map(mapVideo),
    newEpisodes: async (n = 30) => list(await req(`/Users/${s.userId}/Items/Latest?` + Q({ IncludeItemTypes: "Episode", Limit: n, Fields: FIELDS, EnableUserData: true, GroupItems: true }))).map(mapVideo),
    seasons: async id => list(await req(`/Shows/${id}/Seasons?` + Q({ UserId: s.userId, Fields: FIELDS }))).map(i => ({ id: i.Id, name: (i.Name || "").toLowerCase(), index: i.IndexNumber })),
    episodes: async (showId, seasonId) => list(await req(`/Shows/${showId}/Episodes?` + Q({ UserId: s.userId, SeasonId: seasonId, Fields: FIELDS, EnableUserData: true }))).map(mapVideo),
    // live tv guide
    channels: async () => list(await req("/LiveTv/Channels?" + Q({ UserId: s.userId, EnableImages: true, ImageTypeLimit: 1, EnableImageTypes: "Primary", EnableUserData: false })))
      .map(i => ({ id: i.Id, name: i.Name || "", number: String(i.ChannelNumber || i.Number || ""), img: img(i.Id, i.ImageTags && i.ImageTags.Primary, "Primary", 120) }))
      .sort((a, b) => (parseFloat(a.number) || 1e9) - (parseFloat(b.number) || 1e9) || a.name.localeCompare(b.name)),
    programs: async (ids, from, to) => list(await req("/LiveTv/Programs?" + Q({
      UserId: s.userId, ChannelIds: ids.join(","), MinEndDate: new Date(from).toISOString(), MaxStartDate: new Date(to).toISOString(),
      SortBy: "StartDate", Fields: "Overview,Genres,PrimaryImageAspectRatio", EnableImages: true, ImageTypeLimit: 1, EnableUserData: false,
    }))).map(i => ({
      id: i.Id, channelId: i.ChannelId, title: i.Name || "", ep: i.EpisodeTitle || "",
      start: date(i.StartDate), end: date(i.EndDate), overview: i.Overview || "", genres: i.Genres || [],
      img: img(i.Id, i.ImageTags && i.ImageTags.Primary, "Primary", 720),
      aspect: i.PrimaryImageAspectRatio || 0, // guide pictures are usually portrait posters (about 0.67)
      isNew: !!(i.IsNew || i.IsPremiere), isLive: !!i.IsLive, isMovie: !!i.IsMovie,
    })),
    liveStream, stopStream,
    videoStream, report, artistInfo,
    mediaLibs, folder, everything,
    lyrics,
    // either
    resume: async () => list(await req(`/Users/${s.userId}/Items/Resume?` + Q({ Limit: 12, MediaTypes: "Video", Fields: FIELDS }))).map(mapVideo),
    artistBackdrop: a => a && a.id ? `${s.server}/emby/Items/${a.id}/Images/Backdrop?maxHeight=1080&quality=85` : null,
    hashHue,
  };

  return {
    get state() { return s; },
    get connected() { return !!s.token; },
    connect, libraries, signOut, req, ...api,
  };
})();
