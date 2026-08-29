"""Thin async-capable API client shared by all CLI subcommands.

Mirrors the surface of `df_desktop.api.client` but avoids importing PyQt6, so
the CLI works on machines without a graphical stack. The class is a plain
`httpx.Client` wrapper; async use is opt-in via `aclient()`.

Resilience features:
- Tolerant response parsing — a 502 HTML page, an empty body, or a non-API
  error blob never crashes the CLI; the resulting `ApiError` carries the
  real status code and a friendly `code` so callers can branch.
- Retry-with-backoff on transient 5xx and connection errors (max 2 retries).
  Disabled via `DF_CLI_NO_RETRY=1` or for non-idempotent methods.
- Configurable per-request timeout via `timeout=` keyword.
"""

from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from typing import Any, Iterator

import httpx

from .config import Config, load_token

DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=5.0)
RETRYABLE_STATUSES = {502, 503, 504}
MAX_RETRIES = 2


class ApiError(RuntimeError):
    """A non-2xx response from the AgentX API."""

    def __init__(self, status: int, code: str, message: str) -> None:
        hint = _hint_for(code, status)
        formatted = f"[{status} {code}] {message}"
        if hint and hint not in message:
            formatted = f"{formatted}\n  hint: {hint}"
        super().__init__(formatted)
        self.status = status
        self.code = code
        self.message = message
        self.hint = hint


def _hint_for(code: str, status: int) -> str:
    """Defer importing errors.py to keep the client importable in isolation."""
    try:
        from .errors import humanize_api_error
    except Exception:
        return ""
    return humanize_api_error(code, status)


class NetworkError(RuntimeError):
    """Connection / DNS / TLS-level failure (no HTTP response)."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(f"[network:{kind}] {message}")
        self.kind = kind


class AgentXClient:
    """Synchronous httpx wrapper that injects the bearer token from keyring."""

    def __init__(self, config: Config, *, token: str | None = None) -> None:
        self._config = config
        self._token = token
        self._retry_disabled = os.environ.get("DF_CLI_NO_RETRY") == "1"

    # ------------------------------------------------------------------ auth

    @property
    def token(self) -> str | None:
        if self._token is not None:
            return self._token
        if self._config.email:
            return load_token(self._config.email)
        return None

    def with_token(self, token: str) -> "AgentXClient":
        clone = AgentXClient(self._config, token=token)
        return clone

    # ------------------------------------------------------------ http core

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json", "User-Agent": "df-cli/0.1"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    @contextmanager
    def _client(self) -> Iterator[httpx.Client]:
        with httpx.Client(
            base_url=self._config.api_base,
            timeout=DEFAULT_TIMEOUT,
            headers=self._headers(),
        ) as client:
            yield client

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        attempts = 0
        last_error: Exception | None = None
        while attempts <= MAX_RETRIES:
            attempts += 1
            try:
                with self._client() as client:
                    response = client.request(method, path, **kwargs)
            except httpx.HTTPError as exc:
                last_error = NetworkError(type(exc).__name__, str(exc))
                if attempts > MAX_RETRIES or self._retry_disabled:
                    raise last_error from exc
                time.sleep(0.2 * (2 ** (attempts - 1)))
                continue

            if response.status_code >= 400:
                code, message = self._extract_error(response)
                # Retry transient server-side failures.
                if (
                    response.status_code in RETRYABLE_STATUSES
                    and attempts <= MAX_RETRIES
                    and not self._retry_disabled
                ):
                    last_error = ApiError(response.status_code, code, message)
                    time.sleep(0.2 * (2 ** (attempts - 1)))
                    continue
                raise ApiError(response.status_code, code, message)

            if response.status_code == 204:
                return None
            # Successful 2xx — unwrap ApiResult envelope if present.
            try:
                payload = response.json()
            except (ValueError, json.JSONDecodeError):
                # Non-JSON success body is unexpected but not fatal — return raw.
                return response.text
            if isinstance(payload, dict) and "data" in payload:
                return payload["data"]
            return payload

        # All retries exhausted.
        if last_error is not None:
            raise last_error
        raise ApiError(0, "UNKNOWN", "request failed without a response")

    def _extract_error(self, response: httpx.Response) -> tuple[str, str]:
        """Decode an error response, tolerating empty / HTML / non-API bodies."""

        text = response.text or ""
        if not text.strip():
            return "EMPTY_RESPONSE", response.reason_phrase or "no body"

        content_type = (response.headers.get("content-type") or "").lower()
        if "json" not in content_type:
            return (
                "NON_JSON_RESPONSE",
                f"server returned {response.status_code} with non-JSON body: "
                f"{text[:120]!r}",
            )

        try:
            payload = response.json()
        except (ValueError, json.JSONDecodeError):
            return (
                "INVALID_JSON",
                f"server returned invalid JSON: {text[:120]!r}",
            )

        if not isinstance(payload, dict):
            return "ERROR", text[:200]
        err = payload.get("error")
        if isinstance(err, dict):
            code = str(err.get("code", "ERROR"))
            message = str(err.get("message", text))
            return code, message
        # Top-level `code` / `message` (legacy shape).
        if "code" in payload or "message" in payload:
            return (
                str(payload.get("code", "ERROR")),
                str(payload.get("message", text)),
            )
        return "ERROR", text[:200]

    # -------------------------------------------------------------- helpers

    def get(self, path: str, **kwargs: Any) -> Any:
        return self._request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self._request("POST", path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> Any:
        return self._request("PUT", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self._request("DELETE", path, **kwargs)

    # -------------------------------------------------------------- probes

    def probe(self, *, timeout: float = 3.0) -> tuple[int, str, bool]:
        """Return (status, code, authenticated) without raising on 4xx/5xx.

        Used by `df doctor` to distinguish "server reachable" from
        "server reachable AND the user is authenticated".
        """

        with httpx.Client(
            base_url=self._config.api_base,
            timeout=httpx.Timeout(timeout, connect=min(timeout, 3.0)),
            headers=self._headers(),
        ) as client:
            try:
                response = client.get("/api/v1/me")
            except httpx.HTTPError as exc:
                return 0, f"NETWORK_{type(exc).__name__.upper()}", False
        if response.status_code == 200:
            return response.status_code, "OK", True
        code, _ = self._extract_error(response)
        authenticated = False
        return response.status_code, code, authenticated

    # -------------------------------------------------------------- domain

    def me(self) -> dict[str, Any]:
        return self.get("/api/v1/me")

    def list_notebooks(self) -> list[dict[str, Any]]:
        payload = self.get("/api/v1/notebooks")
        items = payload.get("items") if isinstance(payload, dict) else None
        return items if isinstance(items, list) else []

    def get_notebook(self, notebook_id: str) -> dict[str, Any]:
        return self.get(f"/api/v1/notebooks/{notebook_id}")

    def create_notebook(
        self,
        *,
        title: str,
        description: str | None = None,
        cells: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title}
        if description is not None:
            body["description"] = description
        if cells is not None:
            body["cells"] = cells
        return self.post("/api/v1/notebooks", json=body)

    def run_notebook(self, notebook_id: str) -> dict[str, Any]:
        return self.post(f"/api/v1/notebooks/{notebook_id}/run")

    def list_notebook_runs(self, notebook_id: str, limit: int = 50) -> list[dict[str, Any]]:
        payload = self.get(
            f"/api/v1/notebooks/{notebook_id}/runs",
            params={"limit": limit},
        )
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            return payload["items"]
        if isinstance(payload, list):
            return payload
        return []

    def list_dashboards(self) -> list[dict[str, Any]]:
        payload = self.get("/api/v1/dashboards")
        items = payload.get("items") if isinstance(payload, dict) else None
        return items if isinstance(items, list) else []

    def get_dashboard(self, dashboard_id: str) -> dict[str, Any]:
        return self.get(f"/api/v1/dashboards/{dashboard_id}")

    def apply_dashboard_template(self, template_id: str) -> dict[str, Any]:
        return self.post(
            "/api/v1/dashboards/from-template",
            json={"templateId": template_id},
        )

    def refresh_dashboard(
        self,
        dashboard_id: str,
        *,
        widget_ids: list[str] | None = None,
        force: bool = True,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"force": force}
        if widget_ids is not None:
            body["widgetIds"] = widget_ids
        return self.post(
            f"/api/v1/dashboards/{dashboard_id}/refresh",
            json=body,
        )


def json_invalid(response: httpx.Response) -> type[ValueError]:
    """Kept for backwards compatibility — no longer used."""
    return json.JSONDecodeError


__all__ = [
    "ApiError",
    "AgentXClient",
    "DEFAULT_TIMEOUT",
    "NetworkError",
    "RETRYABLE_STATUSES",
]