"""Media Center helper — serves the app and does the few things a web page isn't allowed to do.

Run:  py -3 tools\\serve.py        (or use "Start Media Center.bat")
Then open http://127.0.0.1:8765/

What it does
  * Serves the files in the app folder.
  * Voice control: answers JSON-RPC at http://127.0.0.1:8765/jsonrpc, the same commands the old
    Zune hub took (GUI.ActivateWindow, Input.ExecuteAction, Player.GetItem, Player.PlayMusic, …),
    so the voice assistant works unchanged. Commands are handed to the open app page, which carries
    them out and sends back the answer. Guide.Search is answered here, from a copy of the guide the
    app keeps up to date.
  * YouTube: remembers where VacuumTube.exe is and starts it full screen when the app asks.
  * Voice assistant: if its folder is set, starts it (and its mic listener) along with the helper.
  * Lyrics: reads a song's .lrc file for the app when Emby keeps the music on this PC.

Safety
  * Listens on this PC only (127.0.0.1), never on the network.
  * The app page's own requests must carry the header "X-Media-Center: 1"; /jsonrpc refuses
    requests coming from other web pages (browsers mark those with an Origin header).
  * It will only ever start a file named VacuumTube.exe, and the voice assistant's app.py and
    local_listener_single_whisper.py from the folder set in settings → apps.
  * The only files it reads for the app (besides its own) are .lrc lyrics files.
  * "Sign in to youtube" opens only YouTube's own Google sign-in page, in the app's Edge profile.
  * YouTube "enter this code" sign-in: the long-lived pass stays in tools/apps.json; the app gets
    only short-lived, read-only access to your YouTube (subscriptions, playlists, likes).
  * The guide copy (tools/guide_cache.json) holds listings only — never your Emby sign-in.

Python 3.8+ standard library only — nothing to install.
"""
import http.server
import itertools
import json
import os
import socketserver
import subprocess
import sys
import threading
import time
from datetime import datetime
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "app"))
CONFIG = os.path.join(HERE, "apps.json")          # VacuumTube location
GUIDE_FILE = os.path.join(HERE, "guide_cache.json")  # listings for voice guide search
PORT = int(os.environ.get("PORT", "8765"))         # the port the voice assistant talks to
ALLOWED_EXE = "vacuumtube.exe"
LOCAL_HOSTS = ("127.0.0.1", "localhost")


# ---------------------------------------------------------------- youtube (VacuumTube)
def load_config():
    try:
        with open(CONFIG, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def valid_vacuumtube(path):
    path = (path or "").strip().strip('"')
    if not path or os.path.basename(path).lower() != ALLOWED_EXE:
        return None, "that isn't VacuumTube.exe"
    if not os.path.isfile(path):
        return None, "VacuumTube.exe wasn't found at that location"
    return os.path.abspath(path), None


# ---------------------------------------------------------------- command bridge (voice → app page)
class Bridge:
    """Hands JSON-RPC commands to the app page (which long-polls) and waits for its answer."""

    def __init__(self):
        self.cv = threading.Condition()
        self.queue = []
        self.waiting = {}  # id -> {"done": Event, "reply": dict}
        self.ids = itertools.count(1)
        self.last_poll = 0.0

    def connected(self):
        return time.time() - self.last_poll < 35  # the page polls at least every ~25 s

    def call(self, method, params, timeout=20.0):
        if not self.connected():
            raise RuntimeError("the media center app isn't open")
        cid = next(self.ids)
        slot = {"done": threading.Event(), "reply": None}
        with self.cv:
            self.waiting[cid] = slot
            self.queue.append({"id": cid, "method": method, "params": params or {}})
            self.cv.notify_all()
        if not slot["done"].wait(timeout):
            with self.cv:
                self.waiting.pop(cid, None)
                self.queue = [c for c in self.queue if c["id"] != cid]
            raise RuntimeError("the media center app didn't answer in time")
        reply = slot["reply"] or {}
        if "error" in reply:
            err = reply["error"]
            raise RuntimeError(err.get("message") if isinstance(err, dict) else str(err))
        return reply.get("result")

    def poll(self, wait_s=25.0):
        self.last_poll = time.time()
        deadline = time.time() + wait_s
        with self.cv:
            while not self.queue:
                left = deadline - time.time()
                if left <= 0:
                    self.last_poll = time.time()
                    return {}
                self.cv.wait(left)
            self.last_poll = time.time()
            return self.queue.pop(0)

    def answer(self, reply):
        with self.cv:
            slot = self.waiting.pop(reply.get("id"), None)
        if slot:
            slot["reply"] = reply
            slot["done"].set()


BRIDGE = Bridge()


# ---------------------------------------------------------------- guide search (Guide.Search)
GUIDE = {"saved_at": 0, "channels": [], "programs": []}
GUIDE_LOCK = threading.Lock()
GUIDE_FRESH_SEC = 30 * 60


def load_guide():
    try:
        with open(GUIDE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        with GUIDE_LOCK:
            GUIDE.update({k: data.get(k, GUIDE[k]) for k in GUIDE})
    except (OSError, ValueError):
        pass


def save_guide(data):
    with GUIDE_LOCK:
        GUIDE["saved_at"] = int(time.time() * 1000)
        GUIDE["channels"] = list(data.get("channels") or [])
        GUIDE["programs"] = list(data.get("programs") or [])
        snapshot = dict(GUIDE)
    try:
        with open(GUIDE_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)
    except OSError:
        pass
    return len(snapshot["programs"])


def parse_ms(iso):
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.astimezone()  # no zone given: treat as this PC's local time
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def spoken_time(ms):
    dt = datetime.fromtimestamp(ms / 1000)  # this PC's time zone
    h12 = dt.strftime("%I").lstrip("0") or "12"
    return f"{h12} {dt.strftime('%p').lower()}" if dt.minute == 0 else f"{h12}:{dt.strftime('%M')} {dt.strftime('%p').lower()}"


def match_label(prog, ch, when):
    name = str(ch.get("Name") or "TV").strip()
    pname = str(prog.get("Name") or "").strip()
    ep = str(prog.get("EpisodeTitle") or "").strip()
    show = f"{pname}, {ep}" if ep and pname and ep.lower() != pname.lower() else (pname or ep or "Program")
    label = f"{show} on {name}"
    start = parse_ms(prog.get("StartDate"))
    if when != "now" and start:
        label += f" at {spoken_time(start)}"
    return label


def program_matches(prog, ch, params, now_ms):
    start, end = parse_ms(prog.get("StartDate")), parse_ms(prog.get("EndDate"))
    if start is None:
        return False
    end = end or start + 30 * 60 * 1000
    when = str(params.get("when") or "now")
    if when == "now" and not (start <= now_ms < end):
        return False
    if when == "later" and not start > now_ms:
        return False
    if when == "tonight":
        midnight = datetime.fromtimestamp(now_ms / 1000).replace(hour=23, minute=59, second=59)
        if not (now_ms < start <= int(midnight.timestamp() * 1000)):
            return False
    channel_q = str(params.get("channelQuery") or params.get("channel_query") or "").strip().lower()
    if channel_q and channel_q not in f"{ch.get('ChannelNumber') or ''} {ch.get('Name') or ''}".lower():
        return False
    genres = " ".join(str(g) for g in (prog.get("Genres") or [])).lower()
    hay = " ".join(str(x) for x in (prog.get("Name"), prog.get("EpisodeTitle"), prog.get("Overview"), genres) if x).lower()
    for g in params.get("genres") or []:
        g = str(g).lower()
        if g and g not in genres and g not in hay:
            return False
    if params.get("requireMovie") and "movie" not in genres and "movie" not in hay:
        return False
    terms = [str(t).lower() for t in (params.get("terms") or []) if str(t).strip()]
    if terms:
        mode = str(params.get("termsMatch") or params.get("terms_match") or "all").lower()
        if mode == "any" and not any(t in hay for t in terms):
            return False
        if mode != "any" and not all(t in hay for t in terms):
            return False
    return True


def guide_search(params):
    params = dict(params or {})
    with GUIDE_LOCK:
        have = bool(GUIDE["programs"])
        fresh = time.time() * 1000 - GUIDE["saved_at"] < GUIDE_FRESH_SEC * 1000
    # stale, empty or asked to refresh: ask the open app to send a fresh copy first
    if (params.get("refresh") or not have or not fresh) and BRIDGE.connected():
        try:
            BRIDGE.call("Guide.Refresh", {}, timeout=15.0)
        except RuntimeError as e:
            if not have:
                return {"error": f"couldn't load the guide: {e}", "matches": [], "matchCount": 0}
    with GUIDE_LOCK:
        channels, programs, saved_at = list(GUIDE["channels"]), list(GUIDE["programs"]), GUIDE["saved_at"]
    if not programs:
        return {"error": "No guide yet — open the media center and sign in to Emby so the guide loads.", "matches": [], "matchCount": 0}
    now_ms = int(time.time() * 1000)
    when = str(params.get("when") or "now")
    by_id = {str(c.get("Id")): c for c in channels}
    seen, matches = set(), []
    for prog in programs:
        ch = by_id.get(str(prog.get("ChannelId")), {})
        if not isinstance(prog, dict) or not program_matches(prog, ch, params, now_ms):
            continue
        key = f"{prog.get('Id')}|{prog.get('StartDate')}"
        if key in seen:
            continue
        seen.add(key)
        matches.append({
            "channelId": prog.get("ChannelId"), "channelName": ch.get("Name") or "TV",
            "channelNumber": str(ch.get("ChannelNumber") or ""), "name": prog.get("Name") or "",
            "episodeTitle": prog.get("EpisodeTitle") or "", "startDate": prog.get("StartDate"),
            "endDate": prog.get("EndDate"), "label": match_label(prog, ch, when),
        })
    matches.sort(key=lambda m: parse_ms(m["startDate"]) or 0)
    limit = int(params.get("limit") or 12)
    if limit > 0:
        matches = matches[:limit]
    return {
        "ok": True, "fresh": now_ms - saved_at < GUIDE_FRESH_SEC * 1000,
        "matchCount": len(matches), "matches": matches, "programCount": len(programs),
    }


# ---------------------------------------------------------------- web server
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    def from_other_site(self):
        origin = self.headers.get("Origin")
        return bool(origin) and urlparse(origin).hostname not in LOCAL_HOSTS

    def trusted(self):
        """Only the app page itself may use /apps/, /guide/ and the page side of /jsonrpc."""
        return self.headers.get("X-Media-Center") == "1" and not self.from_other_site()

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, limit=64 * 1024):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(min(n, limit)) or b"{}")
        except (ValueError, OSError):
            return {}

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/jsonrpc/status":
            return self.send_json({"connected": BRIDGE.connected()})
        if path == "/jsonrpc/poll":
            if not self.trusted():
                return self.send_json({"error": "not allowed"}, 403)
            return self.send_json(BRIDGE.poll())
        if path == "/radio/stream":
            return self.radio_stream()
        if path == "/radio/now":
            if not self.trusted():
                return self.send_json({"error": "not allowed"}, 403)
            from urllib.parse import parse_qs
            url = (parse_qs(urlparse(self.path).query).get("url") or [""])[0]
            with RADIO_LOCK:
                return self.send_json(dict(RADIO_NOW.get(url) or {}))
        if path == "/lyrics":
            # a song's .lrc lyrics file, when Emby keeps the music on this PC (only ever .lrc files)
            if not self.trusted():
                return self.send_json({"error": "not allowed"}, 403)
            from urllib.parse import parse_qs
            file = (parse_qs(urlparse(self.path).query).get("path") or [""])[0]
            if not file.lower().endswith(".lrc") or not os.path.isfile(file) or os.path.getsize(file) > 1024 * 1024:
                return self.send_json({"text": None})
            with open(file, "r", encoding="utf-8-sig", errors="replace") as f:
                return self.send_json({"text": f.read()})
        if path.startswith("/apps/"):
            if not self.trusted():
                return self.send_json({"error": "not allowed"}, 403)
            if path == "/apps/youtube/account":
                return self.send_json({"server": True, **yt_status()})
            if path == "/apps/youtube/token":
                return self.send_json(yt_token())
            if path == "/apps/youtube":
                p = load_config().get("vacuumtube", "")
                return self.send_json({"server": True, "path": p, "ready": bool(p) and os.path.isfile(p)})
            if path == "/apps/assistant":
                folder = load_config().get("assistant", "")
                return self.send_json({"server": True, "path": folder, "ready": bool(folder),
                                       "running": brain_running()})
            return self.send_json({"error": "not found"}, 404)
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/jsonrpc":
            return self.jsonrpc()
        if not self.trusted():
            return self.send_json({"error": "not allowed"}, 403)
        if path == "/jsonrpc/result":
            BRIDGE.answer(self.read_json(4 * 1024 * 1024))
            return self.send_json({"ok": True})
        if path == "/guide/cache":
            count = save_guide(self.read_json(64 * 1024 * 1024))
            return self.send_json({"ok": True, "programs": count})
        if path == "/apps/youtube/path":
            exe, err = valid_vacuumtube(self.read_json().get("path"))
            if err:
                return self.send_json({"ok": False, "error": err})
            cfg = load_config()
            cfg["vacuumtube"] = exe
            save_config(cfg)
            return self.send_json({"ok": True, "path": exe})
        if path == "/apps/youtube/launch":
            return self.send_json(launch_vacuumtube())
        if path == "/apps/youtube/signin":
            return self.send_json(youtube_signin())
        if path == "/apps/youtube/client":
            body = self.read_json()
            cid, secret = str(body.get("id") or "").strip(), str(body.get("secret") or "").strip()
            if not cid.endswith(".apps.googleusercontent.com"):
                return self.send_json({"ok": False, "error": "that doesn't look like a google client id (it ends in .apps.googleusercontent.com)"})
            cfg = load_config()
            cfg["yt_client_id"] = cid
            if secret:
                cfg["yt_client_secret"] = secret
            save_config(cfg)
            return self.send_json({"ok": True})
        if path == "/apps/youtube/code":
            return self.send_json(yt_start())
        if path == "/apps/youtube/signout":
            return self.send_json(yt_signout())
        if path == "/apps/assistant/path":
            folder, err = valid_assistant(self.read_json().get("path"))
            if err:
                return self.send_json({"ok": False, "error": err})
            cfg = load_config()
            cfg["assistant"] = folder
            save_config(cfg)
            return self.send_json({"ok": True, "path": folder})
        if path == "/apps/assistant/start":
            return self.send_json(start_assistant())
        return self.send_json({"error": "not found"}, 404)

    # Radio: passes an AudioAddict station through to the app and reads the song names that the
    # station sends inside the stream (ICY metadata), so the app knows the moment a new song starts.
    def radio_stream(self):
        if self.from_other_site():
            return self.send_json({"error": "not allowed"}, 403)
        from urllib.parse import parse_qs
        import urllib.request
        import urllib.error
        url = (parse_qs(urlparse(self.path).query).get("url") or [""])[0]
        if not radio_url_ok(url):
            return self.send_json({"error": "not a radio station"}, 400)
        req = urllib.request.Request(url, headers={"Icy-MetaData": "1", "User-Agent": "MediaCenter/1.0"})
        try:
            up = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        except Exception:
            return self.send_json({"error": "station unreachable"}, 502)
        self.send_response(200)
        self.send_header("Content-Type", up.headers.get("Content-Type", "audio/mpeg"))
        self.end_headers()
        try:
            metaint = int(up.headers.get("icy-metaint") or 0)
        except ValueError:
            metaint = 0
        buf = b""
        try:
            while True:
                chunk = up.read(8192)
                if not chunk:
                    break
                if metaint <= 0:
                    self.wfile.write(chunk)
                    continue
                buf += chunk
                # audio, then one length byte, then that many ×16 bytes of song info, repeating
                while len(buf) > metaint:
                    size = buf[metaint] * 16
                    if len(buf) < metaint + 1 + size:
                        break
                    self.wfile.write(buf[:metaint])
                    if size:
                        radio_song(url, buf[metaint + 1: metaint + 1 + size])
                    buf = buf[metaint + 1 + size:]
        except OSError:
            pass  # the app stopped listening
        finally:
            up.close()

    # JSON-RPC 2.0, the same commands the voice assistant sent to the old Zune hub
    def jsonrpc(self):
        if self.from_other_site():
            return self.send_json({"error": "not allowed"}, 403)
        req = self.read_json()
        rid, method, params = req.get("id"), str(req.get("method") or ""), req.get("params") or {}
        if not isinstance(params, dict):
            params = {}
        try:
            if method == "Guide.Search":
                result = guide_search(params)
            elif method == "Application.LaunchVacuumTube" and not BRIDGE.connected():
                result = launch_vacuumtube()  # works even if the app page isn't open
            else:
                timeout = 18.0 if method in ("Player.PlayMusic", "Player.PlayRadio", "Player.Open") else 12.0
                result = BRIDGE.call(method, params, timeout)
            return self.send_json({"jsonrpc": "2.0", "id": rid, "result": result})
        except RuntimeError as e:
            return self.send_json({"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": str(e)}})


def launch_vacuumtube():
    exe, err = valid_vacuumtube(load_config().get("vacuumtube"))
    if err:
        return {"ok": False, "error": "set the VacuumTube location in settings → apps"}
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    proc = subprocess.Popen([exe, "--fullscreen"], cwd=os.path.dirname(exe), creationflags=flags, close_fds=True)
    threading.Thread(target=bring_to_front, args=(proc.pid,), daemon=True).start()
    return {"ok": True}


# ---------------------------------------------------------------- youtube "enter this code" sign-in
# Google's sign-in for TVs: the helper asks Google for a short code, the screen shows it, you enter it
# at google.com/device on your phone. The long-lived pass Google returns (refresh token) and the
# sign-in client's details stay here in tools/apps.json; the app only ever gets short-lived access.
YT_SCOPE = "https://www.googleapis.com/auth/youtube.readonly"
YT_LOCK = threading.Lock()
YT_FLOW = {"state": "none"}  # none | waiting | signed_in | denied | expired | error
YT_ACCESS = {"token": None, "until": 0}


def google_post(url, fields):
    import urllib.request
    import urllib.error
    from urllib.parse import urlencode
    req = urllib.request.Request(url, data=urlencode(fields).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read() or b"{}")
        except ValueError:
            out = {"error": f"http {e.code}"}
        out["_status"] = e.code
        return out
    except OSError as e:
        return {"error": "network", "error_description": str(e)}


def yt_client():
    cfg = load_config()
    return cfg.get("yt_client_id", ""), cfg.get("yt_client_secret", "")


def yt_status():
    cid, _ = yt_client()
    with YT_LOCK:
        st = dict(YT_FLOW)
    st.pop("device_code", None)
    st["client"] = bool(cid)
    st["signed_in"] = bool(load_config().get("yt_refresh"))
    if st["signed_in"] and st["state"] in ("none", "expired", "denied", "error"):
        st["state"] = "signed_in"
    return st


def yt_start():
    cid, secret = yt_client()
    if not cid:
        return {"ok": False, "error": "add the sign-in client id and secret first"}
    d = google_post("https://oauth2.googleapis.com/device/code", {"client_id": cid, "scope": YT_SCOPE})
    if "device_code" not in d:
        return {"ok": False, "error": d.get("error_description") or d.get("error") or "google didn't give a code"}
    flow = {"state": "waiting", "device_code": d["device_code"], "code": d["user_code"],
            "url": d.get("verification_url") or d.get("verification_uri") or "https://www.google.com/device",
            "until": time.time() + int(d.get("expires_in", 1800)), "every": int(d.get("interval", 5))}
    with YT_LOCK:
        YT_FLOW.clear()
        YT_FLOW.update(flow)
    threading.Thread(target=yt_poll, args=(flow["device_code"],), daemon=True).start()
    return {"ok": True, "code": flow["code"], "url": flow["url"], "expires_in": int(d.get("expires_in", 1800))}


def yt_poll(device_code):
    cid, secret = yt_client()
    every = YT_FLOW.get("every", 5)
    while True:
        time.sleep(every)
        with YT_LOCK:
            if YT_FLOW.get("device_code") != device_code or YT_FLOW.get("state") != "waiting":
                return
            if time.time() > YT_FLOW.get("until", 0):
                YT_FLOW["state"] = "expired"
                return
        d = google_post("https://oauth2.googleapis.com/token", {
            "client_id": cid, "client_secret": secret, "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"})
        err = d.get("error")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            every += 5
            continue
        with YT_LOCK:
            if YT_FLOW.get("device_code") != device_code:
                return
            if d.get("refresh_token"):
                cfg = load_config()
                cfg["yt_refresh"] = d["refresh_token"]
                save_config(cfg)
                YT_ACCESS.update(token=d.get("access_token"), until=time.time() + int(d.get("expires_in", 3600)) - 60)
                YT_FLOW.clear()
                YT_FLOW.update(state="signed_in")
            else:
                YT_FLOW.clear()
                YT_FLOW.update(state="denied" if err == "access_denied" else "expired" if err == "expired_token" else "error",
                               error=d.get("error_description") or err or "unknown")
            return


def yt_token():
    """A short-lived access token for the app (refreshed here when needed)."""
    with YT_LOCK:
        if YT_ACCESS["token"] and time.time() < YT_ACCESS["until"]:
            return {"ok": True, "token": YT_ACCESS["token"], "until": YT_ACCESS["until"]}
    cid, secret = yt_client()
    refresh = load_config().get("yt_refresh")
    if not refresh or not cid:
        return {"ok": False, "error": "not signed in"}
    d = google_post("https://oauth2.googleapis.com/token", {"client_id": cid, "client_secret": secret,
                                                           "refresh_token": refresh, "grant_type": "refresh_token"})
    if not d.get("access_token"):
        if d.get("error") == "invalid_grant":  # the sign-in was withdrawn or ran out: sign in again
            cfg = load_config()
            cfg.pop("yt_refresh", None)
            save_config(cfg)
        return {"ok": False, "error": d.get("error_description") or d.get("error") or "couldn't refresh"}
    with YT_LOCK:
        YT_ACCESS.update(token=d["access_token"], until=time.time() + int(d.get("expires_in", 3600)) - 60)
        return {"ok": True, "token": YT_ACCESS["token"], "until": YT_ACCESS["until"]}


def yt_signout():
    refresh = load_config().get("yt_refresh")
    if refresh:
        google_post("https://oauth2.googleapis.com/revoke", {"token": refresh})
    cfg = load_config()
    cfg.pop("yt_refresh", None)
    save_config(cfg)
    with YT_LOCK:
        YT_ACCESS.update(token=None, until=0)
        YT_FLOW.clear()
        YT_FLOW.update(state="none")
    return {"ok": True}


def youtube_signin():
    """Opens YouTube's own sign-in page in a new window of the app's Edge profile (browser-data), so
    a YouTube Premium sign-in there also covers the videos the app plays. Only ever this one address;
    the login itself is typed by the user on Google's page."""
    if sys.platform != "win32":
        return {"ok": False, "error": "this only works on windows"}
    profile = os.path.abspath(os.path.join(HERE, "..", "browser-data"))
    url = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F"
    try:
        subprocess.Popen(f'cmd /c start "" msedge --user-data-dir="{profile}" --new-window "{url}"',
                         creationflags=subprocess.CREATE_NO_WINDOW, close_fds=True)
    except OSError as e:
        return {"ok": False, "error": f"couldn't start edge ({e})"}
    threading.Thread(target=bring_to_front, args=(0,), kwargs={"words": ("sign in", "google", "youtube")}, daemon=True).start()
    return {"ok": True}


def bring_to_front(pid, timeout=20.0, words=None):
    """Windows won't let a background program (this helper) put a new window in front of the
    full-screen app, so VacuumTube opened behind it. Wait for its window to appear, then bring it
    forward with the usual workaround (borrow the input focus of the window that has it)."""
    if sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    proc_cb = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def find_window():
        found = []

        def each(hwnd, _):
            if not user32.IsWindowVisible(hwnd) or user32.GetWindowTextLengthW(hwnd) == 0:
                return True
            owner = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            title = buf.value.lower()
            # its own window, or (if VacuumTube was already open and handed over) one titled like it
            if words is not None:  # a window found by its title (e.g. youtube's sign-in page in Edge)
                if any(w in title for w in words) and "media center" not in title:
                    found.append(hwnd)
            elif owner.value == pid or "vacuumtube" in title or ("youtube" in title and "media center" not in title):
                found.append(hwnd)
            return True

        user32.EnumWindows(proc_cb(each), 0)
        return found[0] if found else None

    def focus(hwnd):
        SW_RESTORE, HWND_TOPMOST, HWND_NOTOPMOST, SWP_NOMOVE_NOSIZE = 9, -1, -2, 0x0001 | 0x0002
        fg = user32.GetForegroundWindow()
        fg_thread = user32.GetWindowThreadProcessId(fg, None)
        me = kernel32.GetCurrentThreadId()
        attached = fg_thread and fg_thread != me and user32.AttachThreadInput(me, fg_thread, True)
        try:
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, SW_RESTORE)
            user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE_NOSIZE)
            user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE_NOSIZE)
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(me, fg_thread, False)
        return user32.GetForegroundWindow() == hwnd

    end = time.time() + timeout
    while time.time() < end:
        hwnd = find_window()
        if hwnd and focus(hwnd):
            # it can take a moment for the full-screen window to settle; make sure it stays in front
            time.sleep(1.0)
            if user32.GetForegroundWindow() == hwnd:
                return
        time.sleep(0.3)


# ---------------------------------------------------------------- radio song names
RADIO_HOSTS = ("di.fm", "radiotunes.com", "jazzradio.com", "rockradio.com", "classicalradio.com", "zenradio.com")
RADIO_NOW = {}  # station address -> {"title", "artist", "raw", "at"}
RADIO_LOCK = threading.Lock()


def radio_url_ok(url):
    """Only AudioAddict stations go through the helper."""
    u = urlparse(url or "")
    host = (u.hostname or "").lower()
    return u.scheme in ("http", "https") and any(host == d or host.endswith("." + d) for d in RADIO_HOSTS)


def radio_song(url, block):
    raw = block.rstrip(b"\x00")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")
    import re
    m = re.search(r"StreamTitle='(.*?)';", text, re.S)
    if not m or not m.group(1).strip():
        return
    st = m.group(1).strip()
    artist, title = (st.split(" - ", 1) + [""])[:2] if " - " in st else ("", st)
    with RADIO_LOCK:
        if (RADIO_NOW.get(url) or {}).get("raw") == st:
            return
        RADIO_NOW[url] = {"raw": st, "artist": artist.strip(), "title": title.strip(), "at": time.time()}


# ---------------------------------------------------------------- voice assistant
# The assistant is its own program: app.py (the brain, port 5001) and the Whisper mic listener.
# When its folder is set in settings → apps, the helper starts both (in minimized windows)
# unless they are already running.
ASSISTANT_FILES = ("app.py", "local_listener_single_whisper.py")
ASSISTANT_PORT = 5001
assistant_lock = threading.Lock()


def valid_assistant(folder):
    folder = (folder or "").strip().strip('"')
    if folder.lower().endswith(".py"):  # pasted the path of app.py itself
        folder = os.path.dirname(folder)
    if not folder or not os.path.isdir(folder):
        return None, "that folder wasn't found"
    missing = [f for f in ASSISTANT_FILES if not os.path.isfile(os.path.join(folder, f))]
    if missing:
        return None, "that folder doesn't have " + " and ".join(missing)
    return os.path.abspath(folder), None


def assistant_python(folder):
    """The assistant's own Python if it has a virtual environment, else plain "python" — the same one
    a startup .bat with "python app.py" uses, so its installed packages are found."""
    for env in (".venv", "venv", "env"):
        exe = os.path.join(folder, env, "Scripts", "python.exe")
        if os.path.isfile(exe):
            return exe
    import shutil
    if shutil.which("python"):
        return "python"
    exe = sys.executable
    if os.path.basename(exe).lower() == "pythonw.exe":
        exe = os.path.join(os.path.dirname(exe), "python.exe")
    return exe


def brain_running():
    import socket
    try:
        with socket.create_connection(("127.0.0.1", ASSISTANT_PORT), timeout=0.5):
            return True
    except OSError:
        return False


def listener_running():
    if sys.platform != "win32":
        return False
    query = ("@(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'py*' -and "
             "$_.CommandLine -like '*local_listener_single_whisper*' }).Count")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", query], capture_output=True, text=True,
                             timeout=20, creationflags=subprocess.CREATE_NO_WINDOW).stdout.strip()
        return int(out or 0) > 0
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def run_minimized(folder, script, title):
    """Like the old startup.bat: a minimized window that stays open (so any error stays readable)."""
    py = assistant_python(folder)
    if sys.platform != "win32":
        subprocess.Popen([py, script], cwd=folder, close_fds=True)
        return
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 7  # minimized, without taking the focus from the TV app
    quoted = f'"{py}"' if " " in py else py
    subprocess.Popen(f'cmd /k "title {title} && {quoted} {script}"', cwd=folder, close_fds=True,
                     startupinfo=si, creationflags=subprocess.CREATE_NEW_CONSOLE)


def start_assistant():
    folder, err = valid_assistant(load_config().get("assistant"))
    if err:
        return {"ok": False, "error": "set the voice assistant folder in settings → apps"}
    if not assistant_lock.acquire(blocking=False):
        return {"ok": True, "started": [], "note": "already starting"}
    try:
        started = []
        if not brain_running():
            run_minimized(folder, "app.py", "Assistant")
            started.append("assistant")
            end = time.time() + 45  # the listener talks to it, so give it a moment to come up
            while time.time() < end and not brain_running():
                time.sleep(1)
        if not listener_running():
            run_minimized(folder, "local_listener_single_whisper.py", "Voice")
            started.append("listener")
        return {"ok": True, "started": started}
    finally:
        assistant_lock.release()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    load_guide()
    if load_config().get("assistant"):
        threading.Thread(target=start_assistant, daemon=True).start()
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Media Center running at http://127.0.0.1:{PORT}/  (close this window to stop it)")
        httpd.serve_forever()
