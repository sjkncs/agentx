"""`df init` — configure the API endpoint and store a token in the OS keyring."""

from __future__ import annotations

import argparse

from ..config import (
    Config,
    delete_token,
    load_config,
    save_config,
    save_token,
)
from ..ui import print_info, print_success

CMD_NAME = "init"
CMD_HELP = "Configure API URL and store the access token in the OS keyring."


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(CMD_NAME, help=CMD_HELP)
    parser.add_argument("--api-base", help="API base URL (e.g. https://api.datafoundry.dev)")
    parser.add_argument("--email", help="Login email (used as the keyring username)")
    parser.add_argument("--token", help="Access token to store in the keyring")
    parser.add_argument(
        "--clear-token",
        action="store_true",
        help="Remove the stored token without touching the rest of the config",
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    cfg = load_config()
    api_base = args.api_base or cfg.api_base
    email = args.email or cfg.email

    if not email and not args.clear_token:
        print_info("No --email provided; token will not be stored.")
    if email and args.token:
        save_token(email, args.token)
        print_success(f"Token stored in keyring for {email}.")
    if args.clear_token and email:
        delete_token(email)
        print_success(f"Token for {email} removed from keyring.")

    next_cfg = Config(
        api_base=api_base,
        email=email,
        workspace_id=cfg.workspace_id,
        default_notebook=cfg.default_notebook,
        default_dashboard=cfg.default_dashboard,
        extras=cfg.extras,
    )
    path = save_config(next_cfg)
    print_success(f"Config written to {path}.")
    return 0


__all__ = ["CMD_HELP", "CMD_NAME", "register", "run"]