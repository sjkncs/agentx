"""Unit tests for the keyring + config layer."""

from __future__ import annotations

import os
from pathlib import Path

import yaml

from df_cli.config import (
    Config,
    KEYRING_SERVICE,
    delete_token,
    load_config,
    load_token,
    save_config,
    save_token,
)


def test_default_config_has_sensible_values() -> None:
    cfg = Config()
    assert cfg.api_base == "http://localhost:3000"
    assert cfg.email is None
    assert cfg.extras == {}


def test_save_and_load_round_trip(tmp_path: Path, monkeypatch) -> None:
    cfg_path = tmp_path / "config.yaml"
    monkeypatch.setenv("DF_CLI_CONFIG_PATH", str(cfg_path))

    cfg = Config(api_base="http://x", email="bob@example.com", workspace_id="w")
    save_config(cfg)

    raw = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    assert raw["api_base"] == "http://x"

    loaded = load_config()
    assert loaded.email == "bob@example.com"
    assert loaded.workspace_id == "w"


def test_trailing_slash_is_normalised(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("DF_CLI_CONFIG_PATH", str(tmp_path / "x.yaml"))
    cfg = Config(api_base="http://api.example.com///")
    assert cfg.api_base == "http://api.example.com"


def test_token_storage_round_trip() -> None:
    save_token("carol@example.com", "abc-123")
    assert load_token("carol@example.com") == "abc-123"
    delete_token("carol@example.com")
    assert load_token("carol@example.com") is None


def test_delete_token_is_idempotent() -> None:
    delete_token("never-existed@example.com")
    delete_token("never-existed@example.com")  # no raise


def test_env_overrides_config(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("DF_CLI_CONFIG_PATH", str(tmp_path / "missing.yaml"))
    monkeypatch.setenv("DF_CLI_API_BASE", "http://from-env")
    cfg = load_config()
    assert cfg.api_base == "http://from-env"


def test_keyring_service_name_is_stable() -> None:
    assert KEYRING_SERVICE == "df-cli"