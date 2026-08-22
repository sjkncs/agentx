"""`df run <session-id>` — tail a session log.

The actual streaming endpoint lives in `apps/api/src/server.ts` as
`/api/v1/sessions/:id/stream`. The CLI reads NDJSON line by line and prints each
event with rich formatting. A best-effort polling fallback is used when the
server doesn't advertise Server-Sent Events.
"""

from __future__ import annotations

import argparse
import time

from ..client import ApiError, DataFoundryClient
from ..config import load_config
from ..ui import console, print_error, print_info

CMD_NAME = "run"
CMD_HELP = "Tail a session log (streaming NDJSON)."


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(CMD_NAME, help=CMD_HELP)
    parser.add_argument("session_id")
    parser.add_argument(
        "--follow",
        action="store_true",
        help="Continue tailing after the cursor catches up to the latest event",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Polling interval (seconds) when streaming is unavailable",
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    cfg = load_config()
    client = DataFoundryClient(cfg)
    url = f"/api/v1/sessions/{args.session_id}/stream"
    print_info(f"Streaming {url} from {cfg.api_base}")

    cursor = 0
    while True:
        try:
            events = client.get(url, params={"cursor": cursor})
        except ApiError as err:
            print_error(str(err))
            return 1
        if isinstance(events, list):
            for ev in events:
                cursor = max(cursor, int(ev.get("seq", cursor)))
                if console is not None:
                    console.print(ev)
                else:
                    print(ev)
            if not args.follow:
                break
            if not events:
                time.sleep(max(0.1, args.interval))
            continue
        # Single-event payload — print and exit.
        if console is not None:
            console.print(events)
        else:
            print(events)
        break
    return 0


__all__ = ["CMD_HELP", "CMD_NAME", "register", "run"]