"""Error code glossary surfaced by the CLI.

The CLI's `ApiError.code` is drawn from a small, deliberately closed set so
that scripts and users can branch on it reliably. Every command's print
output that wraps an API error uses `humanize_api_error` to attach the
glossary hint rather than dumping a raw JSON blob.
"""

from __future__ import annotations


ERROR_GUIDANCE: dict[str, str] = {
    "EMPTY_RESPONSE": "Server returned an empty body. Check the proxy / health.",
    "NON_JSON_RESPONSE": (
        "Server replied with non-JSON content (often a 502 from an upstream). "
        "Verify the API is running and on the expected port."
    ),
    "INVALID_JSON": "Server returned malformed JSON. Check the server logs.",
    "BAD_REQUEST": "The request payload is invalid. See the message for details.",
    "RESOURCE_NOT_FOUND": "The target resource does not exist or was archived.",
    "UNAUTHORIZED": "Sign in via `df auth login` and retry.",
    "FORBIDDEN": "Your account lacks permission for this workspace.",
    "AUTH_REQUIRED": "Session expired. Re-run `df auth login`.",
    "INTERNAL_ERROR": "Server-side exception. Retry; open an issue if it persists.",
    "RATE_LIMITED": "Too many requests. Wait a few seconds and retry.",
    "CONFLICT": "Version conflict — refresh and retry.",
    "NOT_FOUND": "Server route is not registered. Check the URL.",
}


def humanize_api_error(code: str, status: int) -> str:
    """Return a short hint tailored to the code, or a generic fallback."""

    if status == 0:
        return "Could not reach the API. Run `df doctor` to diagnose."
    guidance = ERROR_GUIDANCE.get(code)
    if guidance:
        return f"{code}: {guidance}"
    if status >= 500:
        return f"Server error ({status}). Check the server logs."
    if status >= 400:
        return f"Client error ({status} {code}). See the message above."
    return f"Unexpected status {status}."


__all__ = ["ERROR_GUIDANCE", "humanize_api_error"]