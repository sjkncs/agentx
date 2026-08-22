"""End-to-end smoke tests for `df` subcommands.

Each test runs the full `main()` pipeline against the fake client + memory
keyring to assert that the CLI round-trips correctly.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from df_cli.app import main
from df_cli.config import KEYRING_SERVICE, load_config, load_token


def _run(argv: list[str]) -> int:
    return main(argv)


def _extract_json_any(text: str):
    """Pull the first JSON object or array out of `text`."""
    match = re.search(r"\[[\s\S]*?\]|\{[\s\S]*?\}", text)
    assert match is not None, f"no JSON in captured output: {text!r}"
    return json.loads(match.group(0))


def _extract_json(text: str) -> dict:
    """Pull the first JSON object out of `text` (handles UI noise before it)."""
    match = re.search(r"\{[\s\S]*\}", text)
    assert match is not None, f"no JSON object in captured output: {text!r}"
    return json.loads(match.group(0))


def test_init_writes_config_and_token(tmp_config_path: Path) -> None:
    rc = _run([
        "init",
        "--api-base", "https://api.example.com",
        "--email", "alice@example.com",
        "--token", "secret-1",
    ])
    assert rc == 0

    written = yaml.safe_load(tmp_config_path.read_text(encoding="utf-8"))
    assert written["api_base"] == "https://api.example.com"
    assert written["email"] == "alice@example.com"

    token = load_token("alice@example.com")
    assert token == "secret-1"
    assert KEYRING_SERVICE == "df-cli"


def test_status_reports_user_and_workspace(parser, fake_client, capsys) -> None:
    rc = _run(["status"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Authenticated" in out
    assert "demo@example.com" in out
    assert "Demo" in out


def test_status_json_flag(parser, fake_client, capsys) -> None:
    rc = _run(["status", "--json"])
    assert rc == 0
    payload = _extract_json(capsys.readouterr().out)
    assert payload["user"]["email"] == "demo@example.com"


def test_notebook_list_renders_rows(parser, fake_client, capsys) -> None:
    rc = _run(["notebook", "list"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "nb-1" in out
    assert "Welcome" in out
    assert "nb-2" in out


def test_notebook_show_prints_json(parser, fake_client, capsys) -> None:
    rc = _run(["notebook", "show", "nb-42"])
    assert rc == 0
    payload = _extract_json(capsys.readouterr().out)
    assert payload["id"] == "nb-42"
    assert payload["title"] == "Detail"


def test_notebook_create_calls_api(parser, fake_client, capsys, tmp_config_path) -> None:
    rc = _run(["notebook", "create", "--title", "Hello", "--description", "Test"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Created notebook 'Hello'" in out
    cfg = load_config()
    assert cfg.extras["last_created_notebook"].startswith("nb-")


def test_notebook_export_markdown_routes_to_server(parser, monkeypatch, capsys) -> None:
    from df_cli import client as client_mod

    captured: list[tuple[str, str]] = []

    def fake_get(self, path, **kwargs):
        captured.append((path, kwargs.get("params") or {}))
        if path.endswith("/export.md"):
            return "# Notebook\n\nbody"
        if path.endswith("/export.json"):
            return {"id": "nb-1", "cells": []}
        raise AssertionError(path)

    monkeypatch.setattr(client_mod.DataFoundryClient, "get", fake_get)
    rc = _run(["notebook", "export", "nb-1"])
    assert rc == 0
    assert captured and captured[0][0].endswith("/export.md")
    assert "# Notebook" in capsys.readouterr().out


def test_notebook_export_writes_to_file(parser, monkeypatch, tmp_path) -> None:
    from df_cli import client as client_mod

    monkeypatch.setattr(
        client_mod.DataFoundryClient,
        "get",
        lambda self, path, **_: "# Markdown body",
    )
    out_file = tmp_path / "report.md"
    rc = _run(["notebook", "export", "nb-1", "--format", "markdown", "--output", str(out_file)])
    assert rc == 0
    assert out_file.read_text(encoding="utf-8") == "# Markdown body"


def test_notebook_run_queues(parser, fake_client, capsys) -> None:
    rc = _run(["notebook", "run", "nb-99"])
    assert rc == 0
    payload = _extract_json(capsys.readouterr().out)
    assert payload["id"] == "nb-99"
    assert payload["runId"] == "run-9"


def test_dashboard_list_renders_rows(parser, fake_client, capsys) -> None:
    rc = _run(["dashboard", "list"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "db-1" in out
    assert "Ops" in out


def test_dashboard_apply_template(parser, fake_client, capsys, tmp_config_path) -> None:
    rc = _run(["dashboard", "apply-template", "ops-overview", "--title", "My Ops"])
    assert rc == 0
    payload = _extract_json(capsys.readouterr().out)
    assert payload["title"] == "ops-overview"
    cfg = load_config()
    assert cfg.extras["last_dashboard_title"] == "My Ops"


def test_dashboard_refresh_renders_table(parser, fake_client, capsys) -> None:
    rc = _run(["dashboard", "refresh", "db-1", "--force"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "w-1" in out
    assert "w-2" in out
    assert "fresh" in out
    assert "1 refreshed" in out


def test_dashboard_refresh_handles_api_error(parser, monkeypatch, capsys) -> None:
    from df_cli import client as client_mod

    def boom(self, dashboard_id, **kwargs):  # noqa: ANN001
        raise client_mod.ApiError(502, "NON_JSON_RESPONSE", "server down")

    monkeypatch.setattr(client_mod.DataFoundryClient, "refresh_dashboard", boom)
    rc = _run(["dashboard", "refresh", "db-1"])
    assert rc == 1
    assert "server down" in capsys.readouterr().out


def test_notebook_runs_renders_audit_log(parser, fake_client, capsys) -> None:
    rc = _run(["notebook", "runs", "nb-1"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "cell-a" in out
    assert "cell-b" in out
    assert "completed" in out
    assert "failed" in out
    assert "42ms" in out


def test_notebook_runs_json_output(parser, fake_client, capsys) -> None:
    rc = _run(["notebook", "runs", "nb-1", "--json"])
    assert rc == 0
    payload = _extract_json_any(capsys.readouterr().out)
    assert isinstance(payload, list)
    assert len(payload) == 2
    assert payload[0]["cell_id"] == "cell-a"


def test_notebook_runs_empty_message(parser, fake_client, monkeypatch, capsys) -> None:
    from df_cli import client as client_mod

    def empty(self, notebook_id, limit=50):
        return []

    monkeypatch.setattr(client_mod.DataFoundryClient, "list_notebook_runs", empty)
    rc = _run(["notebook", "runs", "nb-x"])
    assert rc == 0
    assert "No runs recorded" in capsys.readouterr().out


def test_run_streaming(parser, fake_client, capsys) -> None:
    rc = _run(["run", "sess-1"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Streaming" in out
    assert "hello" in out


def test_unknown_command_returns_2(parser) -> None:
    # argparse raises SystemExit(2) for unknown subcommands — the handler
    # is never reached. This guards the contract.
    try:
        _run(["notebook", "wat"])
    except SystemExit as exc:
        assert exc.code == 2


def test_help_is_clean(parser, capsys) -> None:
    # argparse exits with code 0 on -h and prints the description banner;
    # we still want to assert that the usage banner is helpful.
    try:
        _run(["--help"])
    except SystemExit as exc:
        assert exc.code == 0
    captured = capsys.readouterr()
    out = captured.out + captured.err
    assert "DataFoundry command-line interface" in out


def test_missing_command_exits_2(parser) -> None:
    try:
        _run([])
    except SystemExit as exc:
        assert exc.code == 2