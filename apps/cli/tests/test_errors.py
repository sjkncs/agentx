"""Tests for `df_cli.errors` and the ApiError hint enrichment."""

from __future__ import annotations

import pytest

from df_cli.client import ApiError
from df_cli.errors import ERROR_GUIDANCE, humanize_api_error


def test_glossary_contains_core_codes() -> None:
    for code in (
        "EMPTY_RESPONSE",
        "NON_JSON_RESPONSE",
        "AUTH_REQUIRED",
        "INTERNAL_ERROR",
    ):
        assert code in ERROR_GUIDANCE


def test_humanize_returns_hint_for_known_code() -> None:
    assert "Re-run" in humanize_api_error("AUTH_REQUIRED", 401)


def test_humanize_returns_generic_for_unknown_code_5xx() -> None:
    message = humanize_api_error("UNKNOWN_ERROR", 500)
    assert "500" in message


def test_humanize_handles_network_status_zero() -> None:
    message = humanize_api_error("UNKNOWN", 0)
    assert "API" in message or "df doctor" in message


def test_api_error_message_includes_hint() -> None:
    err = ApiError(401, "AUTH_REQUIRED", "no session")
    assert "401" in str(err)
    assert "hint:" in str(err)
    assert "Re-run" in str(err)


def test_api_error_handles_missing_glossary_entry() -> None:
    err = ApiError(500, "MADE_UP_CODE", "oh no")
    assert "500" in str(err)
    assert "hint:" in str(err)


@pytest.mark.parametrize("status", [400, 404, 409])
def test_api_error_status_codes_round_trip(status: int) -> None:
    err = ApiError(status, "BAD_REQUEST", f"code {status}")
    assert err.status == status
    assert err.code == "BAD_REQUEST"