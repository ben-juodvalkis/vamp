"""The helper's socket: one JSON request per line in, one JSON reply per line out.

    {"id": 7, "verb": "press", "args": {"target": "transport.tap_tempo"}}
    {"id": 7, "ok": true, "result": {"pressMs": 3.1, ...}, "ms": 4.0, "queuedMs": 0.1}
    {"id": 7, "ok": false, "error": {"code": "ax-control-missing", "detail": "..."}, "ms": 2.2}

One reader thread per connection. Every verb that messages Live runs on the
main thread, in arrival order: Live services Accessibility on its own main
thread one message at a time anyway, and notification waits need a run loop.
`status` is answered on the reader thread and never messages Live, so a 5 s
cold kit swap in flight never makes the bridge think the helper died.

The socket is created owner-only (umask 0177) in a 0700 directory: whoever
can connect can press anything in Live.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import signal
import socket
import threading
import time
from dataclasses import dataclass, field

from .ax import BAD_REQUEST, BUSY, FAILED, AxError

MAX_LINE = 64 * 1024
MAX_PENDING = 16
TICK_S = 2.0


class AlreadyRunning(Exception):
    pass


class _Client:
    def __init__(self, conn: socket.socket):
        self.conn = conn
        self.lock = threading.Lock()
        self.open = True

    def send(self, message: dict) -> None:
        data = (json.dumps(message, ensure_ascii=False, default=str) + "\n").encode("utf-8")
        with self.lock:
            if not self.open:
                return
            try:
                self.conn.sendall(data)
            except OSError:
                self.open = False

    def close(self) -> None:
        with self.lock:
            self.open = False
        try:
            self.conn.close()
        except OSError:
            pass


@dataclass
class _Job:
    client: _Client
    id: object
    verb: str
    args: object
    received: float = field(default_factory=time.monotonic)


def _error(request_id, code: str, detail: str, **extra) -> dict:
    return {"id": request_id, "ok": False, "error": {"code": code, "detail": detail, **extra}}


class Server:
    def __init__(self, helper, socket_path: str, *, log: logging.Logger | None = None,
                 max_pending: int = MAX_PENDING, tick_s: float = TICK_S):
        self.helper = helper
        self.path = socket_path
        self.log = log or logging.getLogger("ax-helper")
        self._jobs: queue.Queue[_Job] = queue.Queue(maxsize=max_pending)
        self._tick_s = tick_s
        self._stop = threading.Event()
        self._listener: socket.socket | None = None
        self._inode: int | None = None
        self.restart = False  # set when the helper asked to re-execute (a fresh grant)

    def stop(self) -> None:
        self._stop.set()

    def bind(self) -> None:
        os.makedirs(os.path.dirname(self.path), mode=0o700, exist_ok=True)
        if os.path.exists(self.path):
            probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            probe.settimeout(1.0)
            try:
                probe.connect(self.path)
            except OSError:
                os.unlink(self.path)  # stale: nobody is listening
            else:
                raise AlreadyRunning(f"another helper is listening on {self.path}")
            finally:
                probe.close()
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        previous = os.umask(0o177)
        try:
            listener.bind(self.path)
        finally:
            os.umask(previous)
        listener.listen(8)
        self._listener = listener
        self._inode = os.stat(self.path).st_ino

    def serve_forever(self) -> int:
        if self._listener is None:
            self.bind()
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                signal.signal(sig, lambda *_: self._stop.set())
        threading.Thread(target=self._accept_loop, name="ax-accept", daemon=True).start()
        self.log.info("listening on %s", self.path)
        try:
            self.helper.on_start()
            next_tick = time.monotonic() + self._tick_s
            while not self._stop.is_set():
                try:
                    job = self._jobs.get(timeout=0.2)
                except queue.Empty:
                    job = None
                if job is not None:
                    self._run(job)
                if time.monotonic() >= next_tick:
                    self._tick()
                    next_tick = time.monotonic() + self._tick_s
                    if getattr(self.helper, "wants_restart", False):
                        self.restart = True
                        break
        finally:
            self._close()
        self.log.info("stopped")
        return 0

    def _tick(self) -> None:
        try:
            self.helper.tick()
        except Exception:
            self.log.exception("tick failed")

    def _accept_loop(self) -> None:
        while not self._stop.is_set():
            try:
                conn, _ = self._listener.accept()
            except OSError:
                return
            threading.Thread(target=self._serve_client, args=(conn,), name="ax-client", daemon=True).start()

    def _serve_client(self, conn: socket.socket) -> None:
        client = _Client(conn)
        buffer = b""
        try:
            while not self._stop.is_set():
                chunk = conn.recv(65536)
                if not chunk:
                    return
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if line.strip():
                        self._on_line(client, line)
                if len(buffer) > MAX_LINE:
                    client.send(_error(None, BAD_REQUEST, f"request line longer than {MAX_LINE} bytes"))
                    return
        except OSError:
            return
        finally:
            client.close()

    def _on_line(self, client: _Client, line: bytes) -> None:
        received = time.monotonic()
        try:
            request = json.loads(line)
        except ValueError:
            client.send(_error(None, BAD_REQUEST, "request is not JSON"))
            return
        if not isinstance(request, dict) or not isinstance(request.get("verb"), str):
            client.send(_error(None, BAD_REQUEST, 'a request is {"id", "verb", "args"}'))
            return
        request_id = request.get("id")
        if request["verb"] == "status":
            reply = {"id": request_id, "ok": True, "result": self.helper.status()}
            reply["ms"] = round((time.monotonic() - received) * 1000, 1)
            client.send(reply)
            return
        try:
            self._jobs.put_nowait(_Job(client, request_id, request["verb"], request.get("args"), received))
        except queue.Full:
            client.send(_error(request_id, BUSY, f"{self._jobs.maxsize} requests already waiting"))

    def _run(self, job: _Job) -> None:
        started = time.monotonic()
        try:
            reply = {"id": job.id, "ok": True, "result": self.helper.dispatch(job.verb, job.args)}
        except AxError as e:
            reply = _error(job.id, e.code, e.detail, **e.extra)
            self.log.info("%s -> %s: %s", job.verb, e.code, e.detail)
        except Exception as e:  # a bug in a verb must cost one reply, not the helper
            self.log.exception("%s failed", job.verb)
            reply = _error(job.id, FAILED, f"{type(e).__name__}: {e}")
        reply["ms"] = round((time.monotonic() - started) * 1000, 1)
        reply["queuedMs"] = round((started - job.received) * 1000, 1)
        job.client.send(reply)

    def _close(self) -> None:
        self._stop.set()
        if self._listener is not None:
            try:
                self._listener.close()
            except OSError:
                pass
        try:
            if self._inode is not None and os.stat(self.path).st_ino == self._inode:
                os.unlink(self.path)
        except OSError:
            pass
