"""`df upgrade` — informational self-update check.

AgentX ships via PyPI, so the canonical upgrade command is
`pip install --upgrade df-cli`. We surface that hint along with the installed
version and the latest version on the index.
"""

from __future__ import annotations

import argparse
import json
import urllib.request

from .. import __version__
from ..ui import print_error, print_info, print_success

CMD_NAME = "upgrade"
CMD_HELP = "Show upgrade instructions (df-cli ships via PyPI)."

PYPI_URL = "https://pypi.org/pypi/df-cli/json"


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(CMD_NAME, help=CMD_HELP)
    parser.add_argument(
        "--no-network",
        action="store_true",
        help="Skip the PyPI version probe (useful in air-gapped environments)",
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    print_info(f"Installed: df-cli {__version__}")
    if args.no_network:
        print_info("Skipping PyPI probe (--no-network).")
        print_info("Upgrade with: pip install --upgrade df-cli")
        return 0

    try:
        with urllib.request.urlopen(PYPI_URL, timeout=5.0) as resp:  # noqa: S310
            payload = json.loads(resp.read())
        latest = payload.get("info", {}).get("version", "?")
    except Exception as exc:  # pragma: no cover - network failures are non-fatal
        print_error(f"PyPI probe failed: {type(exc).__name__}: {exc}")
        return 1

    if latest != __version__:
        print_info(f"Latest:    df-cli {latest}")
        print_success("A newer version is available.")
    else:
        print_success("You are on the latest version.")
    print_info("Upgrade with: pip install --upgrade df-cli")
    return 0


__all__ = ["CMD_HELP", "CMD_NAME", "PYPI_URL", "register", "run"]