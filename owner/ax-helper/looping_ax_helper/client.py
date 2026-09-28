"""`python -m looping_ax_helper.client <verb> ['<json args>']`: one request, reply printed.

A probe tool for the rig. It only talks to the helper's socket, so it needs no
Accessibility trust of its own: run it from any shell.
"""

from __future__ import annotations

import json
import socket
import sys

from .config import load_config


def request(verb: str, args: dict | None = None, *, path: str | None = None, timeout: float = 30.0) -> dict:
    path = path or load_config().socket_path
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        s.connect(path)
        s.sendall((json.dumps({"id": 1, "verb": verb, "args": args or {}}) + "\n").encode("utf-8"))
        buffer = b""
        while not buffer.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buffer += chunk
    return json.loads(buffer)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 64
    args = json.loads(argv[2]) if len(argv) > 2 else {}
    reply = request(argv[1], args)
    print(json.dumps(reply, indent=2, ensure_ascii=False))
    return 0 if reply.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
