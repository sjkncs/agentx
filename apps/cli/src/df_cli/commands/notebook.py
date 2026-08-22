"""`df notebook` subcommands — list, show, create, run."""

from __future__ import annotations

import argparse

from ..client import ApiError, DataFoundryClient, NetworkError
from ..config import load_config, save_config
from ..ui import print_error, print_info, print_success, render_json, render_table

CMD_NAME = "notebook"
CMD_HELP = "Manage notebooks (list, show, create, run)."


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(CMD_NAME, help=CMD_HELP)
    sub = parser.add_subparsers(dest="notebook_command", required=True)

    sub.add_parser("list", help="List all notebooks in the workspace")
    show = sub.add_parser("show", help="Print a notebook")
    show.add_argument("notebook_id")

    create = sub.add_parser("create", help="Create an empty notebook")
    create.add_argument("--title", default="Untitled notebook")
    create.add_argument("--description", default=None)

    run_parser = sub.add_parser("run", help="Trigger a server-side run for every cell")
    run_parser.add_argument("notebook_id")

    export = sub.add_parser("export", help="Export a notebook as Markdown or JSON")
    export.add_argument("notebook_id")
    export.add_argument("--format", choices=["markdown", "json", "md"], default="markdown")
    export.add_argument("--output", help="Write to this file (default: stdout)")

    runs = sub.add_parser("runs", help="List the most recent cell-run audit entries")
    runs.add_argument("notebook_id")
    runs.add_argument("--limit", type=int, default=20, help="Number of rows to return")
    runs.add_argument("--json", action="store_true", help="Output raw JSON")

    use = sub.add_parser("use", help="Persist the default notebook id")
    use.add_argument("notebook_id")

    parser.set_defaults(handler=_dispatch)


def _dispatch(args: argparse.Namespace) -> int:
    handler = {
        "list": _list,
        "show": _show,
        "create": _create,
        "run": _run,
        "export": _export,
        "runs": _runs,
        "use": _use,
    }.get(args.notebook_command)
    if handler is None:
        print_error(f"Unknown notebook command: {args.notebook_command}")
        return 2
    return handler(args)


# --------------------------------------------------------------------- list


def _list(args: argparse.Namespace) -> int:
    cfg = load_config()
    try:
        items = DataFoundryClient(cfg).list_notebooks()
    except ApiError as err:
        print_error(str(err))
        return 1
    rows = [
        [
            item.get("id", "?"),
            item.get("title", "?"),
            str(len(item.get("cells", []))),
            item.get("updatedAt", "")[:19],
        ]
        for item in items
    ]
    render_table(["id", "title", "cells", "updated"], rows)
    return 0


# --------------------------------------------------------------------- show


def _show(args: argparse.Namespace) -> int:
    cfg = load_config()
    try:
        nb = DataFoundryClient(cfg).get_notebook(args.notebook_id)
    except ApiError as err:
        print_error(str(err))
        return 1
    render_json(nb)
    return 0


# ------------------------------------------------------------------- create


def _create(args: argparse.Namespace) -> int:
    cfg = load_config()
    client = DataFoundryClient(cfg)
    try:
        notebook = client.create_notebook(
            title=args.title,
            description=getattr(args, "description", None),
        )
    except ApiError as err:
        print_error(str(err))
        return 1
    notebook_id = notebook.get("id", "?")
    print_success(f"Created notebook '{notebook.get('title', args.title)}' with id {notebook_id}.")
    cfg.extras["last_created_notebook"] = notebook_id
    save_config(cfg)
    return 0


# ----------------------------------------------------------------------- run


def _run(args: argparse.Namespace) -> int:
    cfg = load_config()
    try:
        result = DataFoundryClient(cfg).run_notebook(args.notebook_id)
    except ApiError as err:
        print_error(str(err))
        return 1
    print_success(f"Run queued for notebook {args.notebook_id}.")
    render_json(result)
    return 0


# ----------------------------------------------------------------------- export


def _export(args: argparse.Namespace) -> int:
    """Download a notebook and serialise it as Markdown or JSON.

    The server already exposes `GET /api/v1/notebooks/<id>/export.md` and
    `export.json`; we route through those endpoints so any future server-side
    additions (audit footer, attached artifacts) propagate automatically.
    """
    fmt = "md" if args.format in {"md", "markdown"} else "json"
    cfg = load_config()
    client = DataFoundryClient(cfg)
    try:
        body = client.get(f"/api/v1/notebooks/{args.notebook_id}/export.{fmt}")
    except ApiError as err:
        print_error(str(err))
        return 1
    except NetworkError as err:
        print_error(str(err))
        return 1
    if isinstance(body, dict) and "data" in body:
        body = body["data"]
    if not isinstance(body, str):
        # Server returned JSON — re-serialise deterministically so the file
        # diff is human-readable.
        import json
        body = json.dumps(body, indent=2, ensure_ascii=False)
    if args.output:
        from pathlib import Path
        Path(args.output).write_text(body, encoding="utf-8")
        print_success(f"Exported notebook to {args.output}.")
    else:
        print(body)
    return 0


# ----------------------------------------------------------------------- runs (audit log)


def _runs(args: argparse.Namespace) -> int:
    """Print the cell-run audit log for a notebook."""
    cfg = load_config()
    client = DataFoundryClient(cfg)
    try:
        items = client.list_notebook_runs(args.notebook_id, limit=args.limit)
    except ApiError as err:
        print_error(str(err))
        return 1
    if not items:
        print_info(f"No runs recorded for notebook '{args.notebook_id}'.")
        return 0
    if args.json:
        import json
        print(json.dumps(items, indent=2, ensure_ascii=False))
        return 0
    rows: list[list[str]] = []
    for entry in items:
        status = str(entry.get("status", "?"))
        duration_ms = entry.get("elapsed_ms")
        ts = entry.get("created_at") or entry.get("timestamp") or ""
        cell_id = str(entry.get("cell_id", "—"))
        rows.append([
            ts[:19] if ts else "—",
            cell_id[:12],
            status,
            f"{duration_ms}ms" if isinstance(duration_ms, (int, float)) else "—",
            str(entry.get("audit_log_id", ""))[:8],
        ])
    render_table(["started", "cell", "status", "elapsed", "audit-id"], rows)
    return 0


# ----------------------------------------------------------------------- use


def _use(args: argparse.Namespace) -> int:
    cfg = load_config()
    cfg.default_notebook = args.notebook_id
    save_config(cfg)
    print_success(f"Default notebook set to {args.notebook_id}.")
    return 0


__all__ = ["CMD_HELP", "CMD_NAME", "register"]