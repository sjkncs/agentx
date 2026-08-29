"""Async-friendly AgentX API client.

A thin httpx wrapper around the same `/api/v1/*` surface used by the web
workbench. Sessions and CSRF tokens are managed transparently so the UI
never has to think about cookies.

Designed to be imported both from Qt main thread code and from
background `QThread` workers.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from .schemas import (
    MeResponse,
    Session,
    SessionList,
    TraceDag,
    DatalinkGraph,
)

DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=5.0)

# Map role names returned by the API → friendly labels shown in the UI.
ROLE_LABELS = {
    "owner": "Owner",
    "admin": "Admin",
    "member": "Member",
    "viewer": "Viewer",
}


class ApiError(RuntimeError):
    """A non-2xx response from the AgentX API."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"[{status} {code}] {message}")
        self.status = status
        self.code = code
        self.message = message


@dataclass
class AuthState:
    """Mutable per-session auth state.

    Held by `AgentXClient` and updated by every call so the UI can show
    the live role badge without an extra round trip.
    """

    email: str | None = None
    role: str | None = None
    user_id: str | None = None
    workspace_id: str | None = None


@dataclass
class AgentXClient:
    """Wraps the AgentX REST API with cookie-aware httpx."""

    base_url: str
    timeout: httpx.Timeout = field(default_factory=lambda: DEFAULT_TIMEOUT)
    _client: httpx.AsyncClient = field(init=False)
    _auth: AuthState = field(default_factory=AuthState, init=False)

    def __post_init__(self) -> None:
        # Strip any trailing slash so joining URLs is unambiguous.
        base = self.base_url.rstrip("/") or "http://127.0.0.1:8797"
        self.base_url = base
        cookies = httpx.Cookies()
        # `cookie_jar` is deprecated in newer httpx — use Cookies directly.
        self._client = httpx.AsyncClient(
            base_url=base,
            timeout=self.timeout,
            cookies=cookies,
            headers={"Accept": "application/json"},
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AgentXClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------
    @property
    def auth(self) -> AuthState:
        return self._auth

    @property
    def is_authenticated(self) -> bool:
        return self._auth.user_id is not None

    async def login(self, email: str, password: str) -> MeResponse:
        result = await self._request(
            "POST",
            "/api/v1/auth/login",
            json={"email": email, "password": password},
        )
        me = MeResponse.model_validate(result["data"])
        self._auth.email = me.user.email
        self._auth.user_id = me.user.id
        self._auth.workspace_id = me.workspace.id
        return me

    async def logout(self) -> None:
        try:
            await self._request("POST", "/api/v1/auth/logout")
        except ApiError:
            # Already logged out; ignore.
            pass
        self._auth = AuthState()

    async def get_me(self) -> MeResponse:
        result = await self._request("GET", "/api/v1/me")
        me = MeResponse.model_validate(result["data"])
        self._auth.email = me.user.email
        self._auth.user_id = me.user.id
        self._auth.workspace_id = me.workspace.id
        self._auth.role = getattr(me, "role", None) or None
        return me

    async def fetch_csrf_token(self) -> str:
        result = await self._request("GET", "/api/v1/auth/csrf")
        return str(result["data"]["csrfToken"])

    # ------------------------------------------------------------------
    # Sessions / runs
    # ------------------------------------------------------------------
    async def list_sessions(self, limit: int = 100) -> SessionList:
        result = await self._request(
            "GET", "/api/v1/sessions", params={"limit": str(limit)}
        )
        return SessionList.model_validate(result["data"])

    async def get_session(self, session_id: str) -> Session:
        result = await self._request(
            "GET", f"/api/v1/sessions/{session_id}"
        )
        return Session.model_validate(result["data"])

    async def get_trace_dag(self, session_id: str, limit: int = 400) -> TraceDag:
        result = await self._request(
            "GET",
            f"/api/v1/sessions/{session_id}/trace-dag",
            params={"limit": str(limit)},
        )
        return TraceDag.model_validate(result["data"])

    async def get_datalink_graph(self, server_id: str) -> DatalinkGraph:
        result = await self._request(
            "GET", f"/api/v1/datalink/{server_id}/graph"
        )
        return DatalinkGraph.model_validate(result["data"])

    # ------------------------------------------------------------------
    # Internal request plumbing
    # ------------------------------------------------------------------
    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        unsafe = method.upper() in {"POST", "PATCH", "PUT", "DELETE"}
        headers: dict[str, str] = {}
        if unsafe:
            # Make sure we have a CSRF cookie; httpx already mirrored whatever
            # the server set, so we just need to forward it.
            token = self._csrf_from_cookies()
            if token:
                headers["X-CSRF-Token"] = token
        response = await self._client.request(
            method,
            path,
            params=params,
            json=json,
            headers=headers,
        )
        try:
            payload = response.json()
        except ValueError:
            raise ApiError(
                status=response.status_code,
                code="INVALID_JSON",
                message=response.text[:200] or "Empty response body",
            ) from None
        if not response.is_success or not isinstance(payload, dict):
            error = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(error, dict):
                raise ApiError(
                    status=response.status_code,
                    code=str(error.get("code", "UNKNOWN")),
                    message=str(error.get("message", "Unknown error")),
                )
            raise ApiError(
                status=response.status_code,
                code="UNKNOWN",
                message=str(payload)[:200] or "Unknown error",
            )
        return payload

    def _csrf_from_cookies(self) -> str | None:
        jar = self._client.cookies
        # httpx stores cookies in a jar keyed by domain; pull the csrf token.
        token = jar.get("df_csrf")  # type: ignore[attr-defined]
        return token if isinstance(token, str) and token else None


# ----------------------------------------------------------------------
# Qt-friendly sync helpers
# ----------------------------------------------------------------------
def run_async(coro_factory: Callable[[], Awaitable[Any]]) -> Any:
    """Run an async coroutine to completion on a fresh event loop.

    Qt's main loop is not asyncio-aware, so workers call this helper to
    drive httpx requests without having to install `qasync`.
    """
    import asyncio

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    if loop.is_running():
        # Already inside an asyncio loop (e.g. inside a test). Block on the
        # coroutine synchronously via `run_until_complete`.
        return loop.run_until_complete(coro_factory())
    return loop.run_until_complete(coro_factory())


@asynccontextmanager
async def live_client(base_url: str) -> AsyncIterator[AgentXClient]:
    """Open a `AgentXClient` for the lifetime of a `with` block."""
    client = AgentXClient(base_url=base_url)
    try:
        yield client
    finally:
        await client.aclose()


__all__ = [
    "ApiError",
    "AuthState",
    "AgentXClient",
    "ROLE_LABELS",
    "live_client",
    "run_async",
    "urlparse",
]