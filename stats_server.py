#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""游戏中心统计服务。

同时做两件事：
1. 静态托管 apps/games（游戏中心 index.html 与各游戏目录，同源，无需 CORS）
2. 提供 /api/stats：按下表聚合 games/<id> 的游玩次数、累计时长、人数、点赞、收藏

    GET  /api/stats   -> {"updatedAt": "...", "games": {"<id>": {...}}}
    POST /api/stats   -> 事件 {"playerId", "gameId", "type", "seconds"?}
                         type: open | close | like | unlike | favorite | unfavorite

数据落盘：apps/games/.stats/stats.json（运行时数据，不进游戏包）。
无鉴权，仅用于本机/内网联调；不要暴露到公网。

用法：
    python apps/games/stats_server.py                 # http://127.0.0.1:8765/
    python apps/games/stats_server.py --host 0.0.0.0  # 手机同网段可访问
    python apps/games/stats_server.py --port 9000
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, ".stats")
DATA_FILE = os.environ.get("GAME_STATS_FILE") or os.path.join(DATA_DIR, "stats.json")
DATA_DIR = os.path.dirname(DATA_FILE)
BACKUP_FILE = DATA_FILE + ".bak"

MAX_SECONDS = 4 * 3600          # 单次上报时长上限（秒）
MAX_PLAYERS = 20000             # 每游戏记录的人数上限
ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
LOCK = threading.Lock()

EVENT_TYPES = {"open", "close", "like", "unlike", "favorite", "unfavorite"}


def iso_now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def empty_store() -> dict:
    return {"version": 2, "updatedAt": iso_now(), "games": {}}


def empty_row() -> dict:
    return {"plays": 0, "seconds": 0, "players": [], "likes": [], "favs": []}


def load_store() -> dict:
    if not os.path.isfile(DATA_FILE):
        return empty_store()
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (ValueError, OSError) as exc:
        try:
            os.replace(DATA_FILE, BACKUP_FILE)
        except OSError:
            pass
        print("[BLOCKING] stats.json 无法解析（%s），已备份为 %s 并重新开始计数" % (exc, os.path.basename(BACKUP_FILE)),
              flush=True)
        return empty_store()

    if not isinstance(data, dict) or not isinstance(data.get("games"), dict):
        return empty_store()

    for row in data["games"].values():
        if not isinstance(row, dict):
            continue
        row["plays"] = int(row.get("plays") or 0)
        row["seconds"] = int(row.get("seconds") or 0)
        for key in ("players", "likes", "favs"):
            values = row.get(key)
            row[key] = [str(v) for v in values] if isinstance(values, list) else []
    return data


def save_store(store: dict) -> None:
    store["updatedAt"] = iso_now()
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, DATA_FILE)


def snapshot(store: dict) -> dict:
    games = {}
    for game_id, row in (store.get("games") or {}).items():
        games[game_id] = {
            "plays": int(row.get("plays") or 0),
            "seconds": int(row.get("seconds") or 0),
            "people": len(row.get("players") or []),
            "likes": len(row.get("likes") or []),
            "favs": len(row.get("favs") or []),
        }
    return {"updatedAt": store.get("updatedAt") or iso_now(), "games": games}


def _toggle(bucket: list, player_id: str, want: bool, limit: int) -> None:
    if want and player_id not in bucket:
        if len(bucket) < limit:
            bucket.append(player_id)
    elif not want and player_id in bucket:
        bucket.remove(player_id)


def apply_event(store: dict, event: dict) -> dict:
    if not isinstance(event, dict):
        raise ValueError("event 必须是对象")

    game_id = str(event.get("gameId") or "").strip()
    player_id = str(event.get("playerId") or "").strip()
    kind = str(event.get("type") or "").strip().lower()

    if not ID_RE.match(game_id):
        raise ValueError("gameId 非法")
    if not ID_RE.match(player_id):
        raise ValueError("playerId 非法")
    if kind not in EVENT_TYPES:
        raise ValueError("type 非法：%s" % kind)

    row = store["games"].setdefault(game_id, empty_row())
    players = row.setdefault("players", [])
    if player_id not in players and len(players) < MAX_PLAYERS:
        players.append(player_id)

    if kind == "open":
        row["plays"] = int(row.get("plays") or 0) + 1
    elif kind == "close":
        try:
            seconds = int(round(float(event.get("seconds") or 0)))
        except (TypeError, ValueError):
            seconds = 0
        row["seconds"] = int(row.get("seconds") or 0) + max(0, min(MAX_SECONDS, seconds))
    elif kind in ("like", "unlike"):
        _toggle(row.setdefault("likes", []), player_id, kind == "like", MAX_PLAYERS)
    else:
        _toggle(row.setdefault("favs", []), player_id, kind == "favorite", MAX_PLAYERS)

    return {"gameId": game_id, "type": kind}


class StatsHandler(SimpleHTTPRequestHandler):
    server_version = "GameCenterStats/2.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _blocked(self) -> bool:
        path = urlparse(self.path).path
        return "/." in path or path.startswith("/.")

    def do_GET(self):  # noqa: N802 - http.server 约定
        path = urlparse(self.path).path
        if path == "/api/stats":
            with LOCK:
                store = load_store()
            self._json(200, snapshot(store))
            return
        if path == "/api/health":
            with LOCK:
                store = load_store()
            self._json(200, {"ok": True, "games": len(store.get("games") or {}), "updatedAt": store.get("updatedAt")})
            return
        if path.startswith("/api/"):
            self._json(404, {"error": "not found"})
            return
        if self._blocked():
            self._json(403, {"error": "forbidden"})
            return
        super().do_GET()

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_POST(self):  # noqa: N802
        if urlparse(self.path).path != "/api/stats":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 8192:
            self._json(400, {"error": "请求体为空或过大"})
            return
        try:
            event = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._json(400, {"error": "invalid json"})
            return

        try:
            with LOCK:
                store = load_store()
                apply_event(store, event)
                save_store(store)
                snap = snapshot(store)
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return

        print("[stats] %s %s player=%s%s" % (
            event.get("gameId"), event.get("type"), str(event.get("playerId"))[:8],
            (" +%ss" % event.get("seconds")) if event.get("seconds") else ""), flush=True)
        self._json(200, snap)

    def log_message(self, fmt, *args):
        if urlparse(self.path).path.startswith("/api/"):
            return
        sys.stderr.write("[http] %s\n" % (fmt % args))


def parse_args(argv):
    host, port = "127.0.0.1", 8765
    index = 0
    while index < len(argv):
        item = argv[index]
        if item == "--host" and index + 1 < len(argv):
            host = argv[index + 1]
            index += 2
            continue
        if item == "--port" and index + 1 < len(argv):
            port = int(argv[index + 1])
            index += 2
            continue
        if item in ("-h", "--help"):
            print(__doc__)
            raise SystemExit(0)
        print("未知参数：%s" % item, file=sys.stderr)
        raise SystemExit(2)
    return host, port


def main(argv=None) -> int:
    host, port = parse_args(list(sys.argv[1:] if argv is None else argv))
    os.makedirs(DATA_DIR, exist_ok=True)
    httpd = ThreadingHTTPServer((host, port), StatsHandler)
    shown = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    print("游戏中心： http://%s:%d/" % (shown, port), flush=True)
    print("统计接口： http://%s:%d/api/stats" % (shown, port), flush=True)
    print("数据文件： %s" % DATA_FILE, flush=True)
    try:
        httpd.serve_forever(poll_interval=0.4)
    except KeyboardInterrupt:
        print("\n[stop] 已退出", flush=True)
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
