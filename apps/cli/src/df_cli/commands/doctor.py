"""`df doctor` — environment diagnostics.

Checks the local config, keyring availability, and (optionally) network
reachability to the configured API base. Distinguishes:

  * `network-down`      — connection refused / DNS failure
  * `auth-required`     — server reachable, but `/api/v1/me` returned 401
  * `forbidden`         — server reachable, but credentials are stale (403)
  * `server-error`      — server replied 5xx
  * `auth-ok`           — `/api/v1/me` returned 200

This lets an operator tell "the server is offline" from "I forgot to
re-authenticate" at a glance.
"""

from __future__ import annotations

import argparse
import sys

from ..client import DataFoundryClient
from ..config import CONFIG_PATH, KEYRING_SERVICE, config_path, load_config, load_token
from ..ui import print_error, print_success, render_table

CMD_NAME = "doctor"
CMD_HELP = "Diagnose the local environment (config, keyring, network)."


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(CMD_NAME, help=CMD_HELP)
    parser.add_argument("--skip-network", action="store_true", help="Skip the network probe")
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    rows: list[list[str]] = []

    # Python version
    rows.append(
        [
            "python",
            sys.version.split()[0],
            "ok" if sys.version_info >= (3, 11) else "warn",
        ]
    )

    # Config file
    path = config_path()
    rows.append(
        ["config path", str(path), "ok" if path == CONFIG_PATH else "overridden"]
    )

    cfg = load_config()
    rows.append(["api base", cfg.api_base, "ok"])

    # Keyring
    if cfg.email:
        token = load_token(cfg.email)
        rows.append(
            [
                f"keyring:{KEYRING_SERVICE}",
                f"<{cfg.email}>",
                "ok" if token else "missing-token",
            ]
        )
    else:
        rows.append(["keyring", "(no email configured)", "skipped"])

    # Network probe — use the client so we get the same timeout/retry logic.
    if not args.skip_network:
        client = DataFoundryClient(cfg)
        status, code, authenticated = client.probe(timeout=3.0)
        if status == 0:
            rows.append(["network", cfg.api_base, f"unreachable ({code})"])
        elif authenticated:
            rows.append(["network", cfg.api_base, "auth-ok (200)"])
        elif status == 401:
            rows.append(["network", cfg.api_base, "auth-required (401)"])
        elif status == 403:
            rows.append(["network", cfg.api_base, "forbidden (403)"])
        elif 500 <= status < 600:
            rows.append(["network", cfg.api_base, f"server-error ({status})"])
        else:
            rows.append(["network", cfg.api_base, f"http {status} ({code})"])

    render_table(["check", "value", "status"], rows)

    failing = [
        r
        for r in rows
        if r[2]
        not in {
            "ok",
            "skipped",
            "overridden",
            "missing-token",
            "auth-ok (200)",
        }
    ]
    if failing:
        for row in failing:
            print_error(f"{row[0]}: {row[2]}")
        return 1

    print_success("All checks passed.")
    return 0


__all__ = ["CMD_HELP", "CMD_NAME", "register", "run"]