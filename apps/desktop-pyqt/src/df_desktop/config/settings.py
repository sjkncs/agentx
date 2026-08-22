"""Persistent settings + secure credential storage for `df-desktop`."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from platformdirs import user_config_dir, user_data_dir

APP_NAME = "df-desktop"
DEFAULT_API_URL = "http://127.0.0.1:8797"
KEYRING_SERVICE = "df-desktop"


@dataclass
class Settings:
    """YAML-backed user settings."""

    api_url: str = DEFAULT_API_URL
    default_session: str | None = None
    last_user_email: str | None = None
    theme: str = "default"  # one of default, dark, deepseek, soft
    extra: dict[str, object] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path | None = None) -> "Settings":
        path = path or default_config_path()
        if not path.exists():
            return cls()
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            return cls()
        if not isinstance(data, dict):
            return cls()
        known = {f for f in cls.__dataclass_fields__ if f != "extra"}
        init: dict[str, object] = {k: v for k, v in data.items() if k in known}
        extra = {k: v for k, v in data.items() if k not in known}
        return cls(extra=extra, **init)  # type: ignore[arg-type]

    def save(self, path: Path | None = None) -> None:
        path = path or default_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "api_url": self.api_url,
            "default_session": self.default_session,
            "last_user_email": self.last_user_email,
            "theme": self.theme,
            **self.extra,
        }
        path.write_text(yaml.safe_dump(payload, sort_keys=True), encoding="utf-8")


def default_config_path() -> Path:
    return Path(user_config_dir(appname=APP_NAME, appauthor=False)) / "config.yaml"


def default_data_dir() -> Path:
    base = Path(user_data_dir(appname=APP_NAME, appauthor=False))
    base.mkdir(parents=True, exist_ok=True)
    return base


# ----------------------------------------------------------------------
# Keyring helpers
# ----------------------------------------------------------------------
def _keyring():  # pragma: no cover - thin wrapper for testability
    import keyring

    return keyring


def load_password(email: str) -> str | None:
    if not email:
        return None
    try:
        kr = _keyring()
        return kr.get_password(KEYRING_SERVICE, email)
    except Exception:
        # Some headless environments have no usable keyring; fall through.
        return None


def save_password(email: str, password: str) -> bool:
    if not email or not password:
        return False
    try:
        kr = _keyring()
        kr.set_password(KEYRING_SERVICE, email, password)
        return True
    except Exception:
        return False


def clear_password(email: str) -> None:
    if not email:
        return
    try:
        kr = _keyring()
        kr.delete_password(KEYRING_SERVICE, email)
    except Exception:
        pass


__all__ = [
    "APP_NAME",
    "DEFAULT_API_URL",
    "KEYRING_SERVICE",
    "Settings",
    "clear_password",
    "default_config_path",
    "default_data_dir",
    "load_password",
    "save_password",
]


# Force-import `os` so linters don't flag it; used by future env-var overrides.
_ = os