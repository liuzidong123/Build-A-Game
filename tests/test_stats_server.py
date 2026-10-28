#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""统计服务端到端测试：python apps/games/tests/test_stats_server.py

启动一个真实进程（独立端口 + 临时数据文件），验证事件聚合、参数校验、
静态托管与重启后持久化。
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(BASE, "stats_server.py")

passed = 0
failed = 0


def check(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print("  PASS  " + name)
    except AssertionError as exc:
        failed += 1
        print("  FAIL  " + name)
        print("        " + str(exc))
    except Exception as exc:  # noqa: BLE001 - 测试里保留原始错误上下文
        failed += 1
        print("  FAIL  " + name)
        print("        %s: %s" % (type(exc).__name__, exc))


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def request(url, payload=None, raw=False):
    if payload is None:
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = resp.read()
            return resp.status, body if raw else json.loads(body.decode("utf-8"))
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def start(port, store_file):
    env = dict(os.environ)
    env["GAME_STATS_FILE"] = store_file
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.Popen([sys.executable, SERVER, "--port", str(port)],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = "http://127.0.0.1:%d" % port
    for _ in range(80):
        try:
            with urllib.request.urlopen(base + "/api/health", timeout=1) as resp:
                if resp.status == 200:
                    return proc, base
        except (urllib.error.URLError, OSError):
            time.sleep(0.1)
    proc.terminate()
    raise RuntimeError("统计服务启动失败（端口 %d）" % port)


def stop(proc):
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def main():
    tmp = tempfile.mkdtemp(prefix="game-stats-")
    store_file = os.path.join(tmp, "stats.json")
    port = free_port()
    proc = None
    try:
        proc, base = start(port, store_file)
        api = base + "/api/stats"

        status, snap = request(api)
        check("新库初始为空", lambda: (
            _eq(status, 200),
            _eq(snap["games"], {})
        ))

        request(api, {"playerId": "p-a", "gameId": "demo", "type": "open"})
        _, snap = request(api, {"playerId": "p-b", "gameId": "demo", "type": "open"})
        check("两个玩家各开一局 → 游玩 2 / 人数 2", lambda: (
            _eq(snap["games"]["demo"]["plays"], 2),
            _eq(snap["games"]["demo"]["people"], 2)
        ))

        request(api, {"playerId": "p-a", "gameId": "demo", "type": "close", "seconds": 120})
        _, snap = request(api, {"playerId": "p-b", "gameId": "demo", "type": "close", "seconds": 30})
        check("时长累加", lambda: _eq(snap["games"]["demo"]["seconds"], 150))

        _, snap = request(api, {"playerId": "p-a", "gameId": "demo", "type": "close", "seconds": 999999})
        check("单次时长被截断到 4 小时", lambda: _eq(snap["games"]["demo"]["seconds"], 150 + 14400))

        request(api, {"playerId": "p-a", "gameId": "demo", "type": "like"})
        _, snap = request(api, {"playerId": "p-a", "gameId": "demo", "type": "like"})
        check("同一玩家重复点赞只算一次", lambda: _eq(snap["games"]["demo"]["likes"], 1))

        _, snap = request(api, {"playerId": "p-b", "gameId": "demo", "type": "like"})
        check("第二个玩家点赞 → 2", lambda: _eq(snap["games"]["demo"]["likes"], 2))

        _, snap = request(api, {"playerId": "p-b", "gameId": "demo", "type": "unlike"})
        check("取消点赞 → 1", lambda: _eq(snap["games"]["demo"]["likes"], 1))

        _, snap = request(api, {"playerId": "p-a", "gameId": "demo", "type": "favorite"})
        check("收藏计数", lambda: _eq(snap["games"]["demo"]["favs"], 1))

        code, _ = request(api, {"playerId": "p-a", "gameId": "demo", "type": "hack"})
        check("未知事件类型 400", lambda: _eq(code, 400))

        code, _ = request(api, {"playerId": "p-a", "gameId": "../etc", "type": "open"})
        check("非法 gameId 400", lambda: _eq(code, 400))

        code, _ = request(api, {"playerId": "", "gameId": "demo", "type": "open"})
        check("空 playerId 400", lambda: _eq(code, 400))

        status, body = request(base + "/", raw=True)
        check("静态首页可访问且是游戏中心", lambda: (
            _eq(status, 200),
            _contains(body.decode("utf-8"), "游戏中心")
        ))

        status, body = request(base + "/idiom-anim/index.html", raw=True)
        check("游戏目录静态托管", lambda: (
            _eq(status, 200),
            _contains(body.decode("utf-8"), "成语")
        ))

        code_403 = 0
        try:
            request(base + "/.stats/stats.json", raw=True)
        except urllib.error.HTTPError as exc:
            code_403 = exc.code
        check("禁止读取 .stats 目录", lambda: _eq(code_403, 403))

        print("重启服务后读取持久化数据")
        stop(proc)
        proc, base = start(port, store_file)
        _, snap = request(base + "/api/stats")
        check("重启后数据仍在", lambda: (
            _eq(snap["games"]["demo"]["plays"], 2),
            _eq(snap["games"]["demo"]["seconds"], 150 + 14400),
            _eq(snap["games"]["demo"]["likes"], 1)
        ))

        check("数据文件为可读 JSON", lambda: _contains(
            open(store_file, "r", encoding="utf-8").read(), '"demo"'))
    finally:
        if proc is not None:
            stop(proc)
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + ("全部通过：%d 项" % passed if not failed else "失败 %d 项 / 通过 %d 项" % (failed, passed)))
    return 1 if failed else 0


def _eq(actual, expected):
    assert actual == expected, "期望 %r，实际 %r" % (expected, actual)


def _contains(haystack, needle):
    assert needle in haystack, "未找到 %r" % needle


if __name__ == "__main__":
    sys.exit(main())
