"""`df status` — print the workspace, current user, and version."""

from __future__ import annotations

import argparse

from .. import __version__
from ..client import ApiError, DataFoundryClient
from ..config import load_config
from ..ui import print_error, print_info, print_success, render_json

CMD_NAME = "status"
CMD_HELP = "Print the workspace, current user, and CLI version."


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(CMD_NAME, help=CMD_HELP)
    parser.add_argument("--json", action="store_true", help="Print the raw API response as JSON")
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    cfg = load_config()
    print_info(f"df-cli {__version__}")
    print_info(f"API base: {cfg.api_base}")
    if cfg.email:
        print_info(f"Email:    {cfg.email}")
    if cfg.workspace_id:
        print_info(f"Workspace: {cfg.workspace_id}")
    try:
        client = DataFoundryClient(cfg)
        me = client.me()
    except ApiError as err:
        print_error(str(err))
        return 1
    if args.json:
        render_json(me)
    else:
        print_success("Authenticated.")
        print_info(f"User:        {me.get('user', {}).get('email') or me.get('user', {}).get('id')}")
        print_info(f"Workspace:   {me.get('workspace', {}).get('name') or me.get('workspace', {}).get('id')}")
        role = me.get("role")
        if role:
            print_info(f"Role:        {role}")
    return 0


__all__ = ["CMD_HELP", "CMD_NAME", "register", "run"]