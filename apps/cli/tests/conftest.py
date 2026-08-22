"""Shared pytest fixtures for `df-cli`."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

# Hermetic test environment — memory keyring + temp config + canned API base.
os.environ.setdefault("DF_CLI_KEYRING_BACKEND", "memory")
os.environ.setdefault("DF_CLI_API_BASE", "http://localhost:9999")


@pytest.fixture
def tmp_config_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    cfg = tmp_path / "config.yaml"
    monkeypatch.setenv("DF_CLI_CONFIG_PATH", str(cfg))
    return cfg


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Replace `DataFoundryClient` with a stub that returns canned payloads."""

    from df_cli import client as client_mod
    from df_cli.commands import (
        dashboard as dash_mod,
        notebook as nb_mod,
        run as run_mod,
        status as status_mod,
    )

    class FakeClient:
        def __init__(self, config: Any, *, token: str | None = None) -> None:  # noqa: D401
            self.config = config
            self.token = token or "fake-token"
            self._calls: list[str] = []

        def with_token(self, token: str) -> "FakeClient":
            return FakeClient(self.config, token=token)

        # ----- domain stubs
        def me(self) -> dict[str, Any]:
            return {
                "user": {"id": "u-1", "email": "demo@example.com"},
                "workspace": {"id": "w-1", "name": "Demo"},
                "role": "owner",
            }

        def list_notebooks(self) -> list[dict[str, Any]]:
            return [
                {
                    "id": "nb-1",
                    "title": "Welcome",
                    "cells": [{"id": "c-1"}, {"id": "c-2"}],
                    "updatedAt": "2026-08-16T00:00:00Z",
                },
                {
                    "id": "nb-2",
                    "title": "Sales",
                    "cells": [{"id": "c-3"}],
                    "updatedAt": "2026-08-15T00:00:00Z",
                },
            ]

        def get_notebook(self, notebook_id: str) -> dict[str, Any]:
            return {"id": notebook_id, "title": "Detail", "cells": []}

        def create_notebook(
            self,
            *,
            title: str,
            description: str | None = None,
            cells: list[dict[str, Any]] | None = None,
        ) -> dict[str, Any]:
            return {
                "id": f"nb-{len(self._calls)}",
                "title": title,
                "description": description or "",
                "cells": cells or [],
            }

        def run_notebook(self, notebook_id: str) -> dict[str, Any]:
            return {"id": notebook_id, "runId": "run-9", "queuedAt": "now"}

        def list_dashboards(self) -> list[dict[str, Any]]:
            return [
                {
                    "id": "db-1",
                    "title": "Ops",
                    "widgets": [{"id": "w-1"}, {"id": "w-2"}],
                    "updatedAt": "2026-08-16T00:00:00Z",
                },
            ]

        def get_dashboard(self, dashboard_id: str) -> dict[str, Any]:
            return {"id": dashboard_id, "title": "Detail", "widgets": []}

        def apply_dashboard_template(self, template_id: str) -> dict[str, Any]:
            return {
                "id": f"db-from-{template_id}",
                "title": template_id,
                "widgets": [],
            }

        def list_notebook_runs(self, notebook_id: str, limit: int = 50):
            return [
                {
                    "cell_id": "cell-a",
                    "status": "completed",
                    "elapsed_ms": 42,
                    "created_at": "2026-08-17T09:30:00Z",
                    "audit_log_id": "audit-12345",
                },
                {
                    "cell_id": "cell-b",
                    "status": "failed",
                    "elapsed_ms": 120,
                    "created_at": "2026-08-17T09:31:05Z",
                    "audit_log_id": "audit-67890",
                },
            ][: limit]

        def refresh_dashboard(
            self,
            dashboard_id: str,
            *,
            widget_ids: list[str] | None = None,
            force: bool = True,
        ) -> dict[str, Any]:
            return {
                "dashboardId": dashboard_id,
                "widgets": [
                    {
                        "id": "w-1",
                        "fresh": force,
                        "cache": {"value": 4321, "updatedAt": "2026-08-17T00:00:00Z"},
                    },
                    {
                        "id": "w-2",
                        "fresh": False,
                        "cache": {"value": 12, "updatedAt": "2026-08-16T00:00:00Z"},
                    },
                ],
            }

        def probe(self, *, timeout: float = 3.0) -> tuple[int, str, bool]:
            return (200, "OK", True)

        # ----- raw http surface — used by `df run <session-id>`.
        def get(self, path: str, **_: Any) -> Any:
            if path.endswith("/stream"):
                return [{"seq": 1, "type": "log", "message": "hello"}]
            raise AssertionError(f"unexpected GET {path}")

    # Patch the class on every module that imported it so the binding in each
    # subcommand's namespace resolves to the fake.
    for mod in (client_mod, dash_mod, nb_mod, run_mod, status_mod):
        monkeypatch.setattr(mod, "DataFoundryClient", FakeClient)
        # The commands import `ApiError` only for re-raise; harmless to leave.
    return FakeClient


@pytest.fixture
def parser():
    from df_cli.app import build_parser

    return build_parser()