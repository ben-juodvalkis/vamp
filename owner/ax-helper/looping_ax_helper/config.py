"""The helper's settings: the `axHelper` section of config/constants.json."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

# owner/ax-helper/looping_ax_helper/config.py -> the repo root
REPO_ROOT = Path(__file__).resolve().parents[3]


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    socket_path: str
    messaging_timeout_s: float


def load_config(root: str | os.PathLike | None = None) -> Config:
    base = Path(root or os.environ.get("LOOPING_PROJECT_ROOT") or REPO_ROOT)
    path = base / "config" / "constants.json"
    try:
        with open(path, encoding="utf-8") as f:
            section = json.load(f).get("axHelper")
    except (OSError, ValueError) as e:
        raise ConfigError(f"cannot read {path}: {e}") from e
    if not isinstance(section, dict):
        raise ConfigError(f"{path} has no axHelper section")
    try:
        return Config(
            socket_path=os.path.expanduser(section["socketPath"]),
            messaging_timeout_s=float(section["messagingTimeoutS"]),
        )
    except (KeyError, TypeError, ValueError) as e:
        raise ConfigError(f"{path} axHelper is incomplete: {e}") from e
