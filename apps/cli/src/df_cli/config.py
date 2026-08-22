"""Persistent CLI configuration + keyring-backed token storage.

`Config` is a pydantic model mirroring the YAML file written by `df init`.
The token never touches disk — it lives in the OS keyring (Windows Credential
Manager, macOS Keychain, Linux Secret Service) under service `df-cli`.

Tests can substitute a custom `keyring` backend through the
`DF_CLI_KEYRING_BACKEND` env var to keep everything hermetic.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import platformdirs
import yaml
from pydantic import BaseModel, Field, field_validator

CONFIG_DIR = platformdirs.user_config_dir("df-cli", "DataFoundry", roaming=False)
CONFIG_PATH = Path(CONFIG_DIR) / "config.yaml"
KEYRING_SERVICE = "df-cli"

ENV_CONFIG_PATH = "DF_CLI_CONFIG_PATH"
ENV_KEYRING_BACKEND = "DF_CLI_KEYRING_BACKEND"
ENV_API_BASE = "DF_CLI_API_BASE"


class Config(BaseModel):
    """Persistent CLI configuration."""

    api_base: str = "http://localhost:3000"
    email: str | None = None
    workspace_id: str | None = None
    default_notebook: str | None = None
    default_dashboard: str | None = None
    # Free-form pass-through used by advanced subcommands.
    extras: dict[str, Any] = Field(default_factory=dict)

    @field_validator("api_base")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/") or "http://localhost:3000"


def config_path() -> Path:
    """Resolve the active config file path, honouring the override env var."""

    override = os.environ.get(ENV_CONFIG_PATH)
    if override:
        return Path(override).expanduser()
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    return CONFIG_PATH


def load_config() -> Config:
    """Load the on-disk config, falling back to defaults when missing."""

    path = config_path()
    if not path.exists():
        env_base = os.environ.get(ENV_API_BASE)
        defaults: dict[str, Any] = {}
        if env_base:
            defaults["api_base"] = env_base
        return Config(**defaults)
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"Config at {path} must be a mapping, got {type(raw).__name__}")
    return Config(**raw)


def save_config(cfg: Config) -> Path:
    """Persist the config to disk and return the path written.

    Wrapped in an exclusive file lock so two concurrent `df init` calls
    cannot interleave writes and produce a truncated YAML.
    """

    from .locks import config_lock, LockAcquisitionError

    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with config_lock(path):
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(
                yaml.safe_dump(
                    cfg.model_dump(exclude_none=True),
                    sort_keys=False,
                    allow_unicode=True,
                ),
                encoding="utf-8",
            )
            os.replace(tmp, path)
    except LockAcquisitionError as err:
        raise RuntimeError(f"Could not save config: {err}") from err
    return path


# ---------------------------------------------------------------------------
# Keyring — thin wrapper so tests can swap the backend.
# ---------------------------------------------------------------------------


_MEMORY_KEYRING: "_MemoryBackend | None" = None


def _resolve_keyring():
    """Return the active keyring backend.

    Honors `DF_CLI_KEYRING_BACKEND=memory` for hermetic tests. The `keyring`
    package is the production backend and gracefully falls back to its
    built-in "fail" backend on headless Linux runners.

    The memory backend is a process-singleton so a value written by one
    command can be read by a later one within the same test process.
    """

    global _MEMORY_KEYRING
    backend_name = os.environ.get(ENV_KEYRING_BACKEND, "system")
    if backend_name == "memory":
        if _MEMORY_KEYRING is None:
            try:
                from keyring import set_keyring

                class _MemoryBackend:
                    def __init__(self) -> None:
                        self._store: dict[tuple[str, str], str] = {}

                    def get_password(self, service: str, username: str) -> str | None:
                        return self._store.get((service, username))

                    def set_password(self, service: str, username: str, password: str) -> None:
                        self._store[(service, username)] = password

                    def delete_password(self, service: str, username: str) -> None:
                        self._store.pop((service, username), None)

                _MEMORY_KEYRING = _MemoryBackend()
                set_keyring(_MEMORY_KEYRING)
            except Exception:  # pragma: no cover - extremely defensive
                _MEMORY_KEYRING = None
        if _MEMORY_KEYRING is not None:
            return _MEMORY_KEYRING
    import keyring as _keyring

    return _keyring


def save_token(email: str, token: str) -> None:
    """Persist `token` in the OS keyring under `KEYRING_SERVICE`/<email>."""

    backend = _resolve_keyring()
    backend.set_password(KEYRING_SERVICE, email, token)


def load_token(email: str) -> str | None:
    """Read the token for `email`. Returns None when absent."""

    backend = _resolve_keyring()
    return backend.get_password(KEYRING_SERVICE, email)


def delete_token(email: str) -> None:
    """Remove the token for `email`. Missing keys are ignored."""

    backend = _resolve_keyring()
    try:
        backend.delete_password(KEYRING_SERVICE, email)
    except Exception:
        # keyring raises `PasswordDeleteError` for missing keys across
        # backends; swallow to keep the UX clean.
        pass


__all__ = [
    "Config",
    "CONFIG_PATH",
    "KEYRING_SERVICE",
    "config_path",
    "delete_token",
    "load_config",
    "load_token",
    "save_config",
    "save_token",
]