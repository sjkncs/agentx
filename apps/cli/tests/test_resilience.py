"""Tests for the resilient API client: error shape tolerance + retry behaviour."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from df_cli.client import ApiError, DataFoundryClient, NetworkError
from df_cli.config import Config


class _FakeTransport(httpx.BaseTransport):
    def __init__(self, handler) -> None:
        self._handler = handler
        self.calls = 0

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        return self._handler(request, self.calls)


@pytest.fixture
def patched_httpx(monkeypatch: pytest.MonkeyPatch) -> _FakeTransport:
    """Replace httpx.Client transport with a controllable fake."""
    transport = _FakeTransport(lambda req, call: httpx.Response(204))
    real_client = httpx.Client
    captured: dict[str, Any] = {}

    def factory(*args: Any, **kwargs: Any) -> Any:
        captured["kwargs"] = kwargs
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    import df_cli.client as cm

    monkeypatch.setattr(cm.httpx, "Client", factory)
    return transport


def _client(token: str = "tok") -> DataFoundryClient:
    cfg = Config(api_base="http://test", email="u@x.com")
    return DataFoundryClient(cfg, token=token)


def test_unwraps_data_envelope_on_success(patched_httpx: _FakeTransport) -> None:
    def handler(_: httpx.Request, __: int) -> httpx.Response:
        return httpx.Response(200, json={"data": {"items": [{"id": "nb-1"}]}})

    patched_httpx._handler = handler
    result = _client().list_notebooks()
    assert result == [{"id": "nb-1"}]


def test_raises_typed_error_on_envelope_error(patched_httpx: _FakeTransport) -> None:
    def handler(_: httpx.Request, __: int) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "RESOURCE_NOT_FOUND", "message": "x"}})

    patched_httpx._handler = handler
    with pytest.raises(ApiError) as info:
        _client().get_notebook("nb-missing")
    assert info.value.status == 404
    assert info.value.code == "RESOURCE_NOT_FOUND"


def test_tolerates_html_error_body(patched_httpx: _FakeTransport) -> None:
    def handler(_: httpx.Request, __: int) -> httpx.Response:
        return httpx.Response(
            502, text="<html>Bad Gateway</html>", headers={"content-type": "text/html"}
        )

    patched_httpx._handler = handler
    with pytest.raises(ApiError) as info:
        _client().me()
    assert info.value.status == 502
    assert info.value.code == "NON_JSON_RESPONSE"


def test_tolerates_empty_body(patched_httpx: _FakeTransport) -> None:
    def handler(_: httpx.Request, __: int) -> httpx.Response:
        return httpx.Response(504, text="")

    patched_httpx._handler = handler
    with pytest.raises(ApiError) as info:
        _client().me()
    assert info.value.code == "EMPTY_RESPONSE"


def test_tolerates_legacy_error_shape(patched_httpx: _FakeTransport) -> None:
    def handler(_: httpx.Request, __: int) -> httpx.Response:
        return httpx.Response(400, json={"code": "BAD", "message": "missing arg"})

    patched_httpx._handler = handler
    with pytest.raises(ApiError) as info:
        _client().me()
    assert info.value.code == "BAD"
    assert info.value.message == "missing arg"


def test_retries_on_transient_5xx(patched_httpx: _FakeTransport, monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[int] = []

    def handler(_: httpx.Request, call: int) -> httpx.Response:
        attempts.append(call)
        if call < 3:
            return httpx.Response(503, json={"error": {"code": "BUSY", "message": "try again"}})
        return httpx.Response(200, json={"data": {"ok": True}})

    patched_httpx._handler = handler
    monkeypatch.setattr("time.sleep", lambda _: None)
    result = _client().me()
    assert result == {"ok": True}
    assert len(attempts) == 3


def test_does_not_retry_4xx(patched_httpx: _FakeTransport) -> None:
    attempts: list[int] = []

    def handler(_: httpx.Request, call: int) -> httpx.Response:
        attempts.append(call)
        return httpx.Response(400, json={"error": {"code": "BAD", "message": "x"}})

    patched_httpx._handler = handler
    with pytest.raises(ApiError):
        _client().me()
    assert len(attempts) == 1


def test_probe_returns_status_code_and_auth_flag(patched_httpx: _FakeTransport) -> None:
    def handler(_: httpx.Request, __: int) -> httpx.Response:
        return httpx.Response(200, json={"data": {"user": {"id": "u-1"}}})

    patched_httpx._handler = handler
    status, code, auth = _client().probe(timeout=1.0)
    assert status == 200
    assert auth is True
    assert code == "OK"


def test_probe_distinguishes_unauthenticated(patched_httpx: _FakeTransport) -> None:
    def handler(_: httpx.Request, __: int) -> httpx.Response:
        return httpx.Response(401, json={"error": {"code": "AUTH_REQUIRED", "message": "login"}})

    patched_httpx._handler = handler
    status, code, auth = _client().probe(timeout=1.0)
    assert status == 401
    assert auth is False
    assert code == "AUTH_REQUIRED"


def test_network_error_distinguishes_from_api_error(patched_httpx: _FakeTransport) -> None:
    def handler(request: httpx.Request, _: int) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    patched_httpx._handler = handler
    with pytest.raises(NetworkError) as info:
        _client().me()
    assert info.value.kind == "ConnectError"