"""Console-script entry point for the `df` command."""

from __future__ import annotations

import argparse
import sys

from . import __version__
from .commands import dashboard, doctor, init, notebook, run, status, upgrade


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="df",
        description="DataFoundry command-line interface — orchestrate notebooks, dashboards, and runs.",
    )
    parser.add_argument("--version", action="version", version=f"df-cli {__version__}")
    parser.add_argument(
        "--api-base",
        help="Override the configured API base URL for this invocation",
    )
    parser.add_argument(
        "--config",
        help="Use a non-default config file path",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    for cmd in (init, status, doctor, notebook, dashboard, run, upgrade):
        cmd.register(sub)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    # Allow one-off overrides without mutating the saved config.
    if args.api_base or args.config:
        import os

        if args.api_base:
            os.environ["DF_CLI_API_BASE"] = args.api_base
        if args.config:
            os.environ["DF_CLI_CONFIG_PATH"] = args.config
    handler = getattr(args, "handler", None)
    if handler is None:
        parser.print_help()
        return 2
    return int(handler(args) or 0)


if __name__ == "__main__":
    sys.exit(main())


__all__ = ["build_parser", "main"]