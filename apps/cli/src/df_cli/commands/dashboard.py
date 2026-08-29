"""`df dashboard` subcommands — list, show, apply-template."""

from __future__ import annotations

import argparse

from ..client import ApiError, AgentXClient
from ..config import load_config, save_config
from ..ui import print_error, print_info, print_success, render_json, render_table

CMD_NAME = "dashboard"
CMD_HELP = "Manage dashboards (list, show, apply-template)."

# Mirror of the in-app template list in `apps/web/src/app/notebook/notebook-store.ts`
# so users can `df dashboard apply exec-summary` without leaving the terminal.
BUILTIN_TEMPLATES = [
    "blank",
    "ops-overview",
    "data-quality",
    "exec-summary",
]


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(CMD_NAME, help=CMD_HELP)
    sub = parser.add_subparsers(dest="dashboard_command", required=True)

    sub.add_parser("list", help="List dashboards in the workspace")
    show = sub.add_parser("show", help="Print a dashboard")
    show.add_argument("dashboard_id")

    apply = sub.add_parser("apply-template", help="Apply a built-in template")
    apply.add_argument("template_id", choices=BUILTIN_TEMPLATES)
    apply.add_argument("--title")

    refresh = sub.add_parser("refresh", help="Run widget refresh against the server")
    refresh.add_argument("dashboard_id")
    refresh.add_argument(
        "--widget",
        action="append",
        default=None,
        help="Widget id to refresh (repeatable). Defaults to every widget with a SQL source.",
    )
    refresh.add_argument(
        "--force",
        action="store_true",
        help="Bypass the server-side cache interval.",
    )

    sub.add_parser("templates", help="List available built-in templates")

    use = sub.add_parser("use", help="Persist the default dashboard id")
    use.add_argument("dashboard_id")

    parser.set_defaults(handler=_dispatch)


def _dispatch(args: argparse.Namespace) -> int:
    handler = {
        "list": _list,
        "show": _show,
        "apply-template": _apply,
        "refresh": _refresh,
        "templates": _templates,
        "use": _use,
    }.get(args.dashboard_command)
    if handler is None:
        print_error(f"Unknown dashboard command: {args.dashboard_command}")
        return 2
    return handler(args)


def _list(args: argparse.Namespace) -> int:
    cfg = load_config()
    try:
        items = AgentXClient(cfg).list_dashboards()
    except ApiError as err:
        print_error(str(err))
        return 1
    rows = [
        [
            item.get("id", "?"),
            item.get("title", "?"),
            str(len(item.get("widgets", []))),
            item.get("updatedAt", "")[:19],
        ]
        for item in items
    ]
    render_table(["id", "title", "widgets", "updated"], rows)
    return 0


def _show(args: argparse.Namespace) -> int:
    cfg = load_config()
    client = AgentXClient(cfg)
    try:
        doc = client.get_dashboard(args.dashboard_id)
    except ApiError as err:
        print_error(str(err))
        return 1
    render_json(doc)
    return 0


def _apply(args: argparse.Namespace) -> int:
    cfg = load_config()
    try:
        result = AgentXClient(cfg).apply_dashboard_template(args.template_id)
    except ApiError as err:
        print_error(str(err))
        return 1
    if args.title:
        cfg.default_dashboard = result.get("id", cfg.default_dashboard)
        cfg.extras["last_dashboard_title"] = args.title
        save_config(cfg)
    print_success(f"Template '{args.template_id}' applied.")
    render_json(result)
    return 0


def _templates(args: argparse.Namespace) -> int:
    rows = [[tpl, ""] for tpl in BUILTIN_TEMPLATES]
    render_table(["template-id", "description"], rows)
    print_info("Run `df dashboard apply-template <id>` to instantiate one.")
    return 0


def _refresh(args: argparse.Namespace) -> int:
    """Trigger server-side widget refresh and print the resulting cache state."""
    cfg = load_config()
    client = AgentXClient(cfg)
    widget_ids = list(args.widget) if args.widget else None
    try:
        result = client.refresh_dashboard(
            args.dashboard_id,
            widget_ids=widget_ids,
            force=args.force,
        )
    except ApiError as err:
        print_error(str(err))
        return 1
    widgets = result.get("widgets", []) if isinstance(result, dict) else []
    if not widgets:
        print_info("No widgets needed refresh.")
        return 0
    rows: list[list[str]] = []
    refreshed_count = 0
    error_count = 0
    empty_count = 0
    for entry in widgets:
        cache = entry.get("cache") or {}
        fresh = bool(entry.get("fresh"))
        widget_id = str(entry.get("id", "?"))
        status = "fresh" if fresh else "cached"
        if cache.get("error"):
            status = "error"
            error_count += 1
        elif cache.get("empty"):
            status = "empty"
            empty_count += 1
        elif fresh:
            refreshed_count += 1
        value_repr = _render_value(cache)
        rows.append([widget_id, status, value_repr, str(cache.get("error", ""))])
    render_table(["widget", "status", "value", "error"], rows)
    print_success(
        f"{refreshed_count} refreshed, {empty_count} empty, {error_count} errored."
    )
    return 0


def _render_value(cache: dict) -> str:
    if not isinstance(cache, dict):
        return "—"
    if "value" in cache and cache["value"] is not None:
        return str(cache["value"])
    if cache.get("series"):
        first = cache["series"][0]
        return f"{first.get('name', 'series')} ({len(first.get('x', []))} points)"
    if cache.get("table"):
        cols = len(cache["table"].get("columns", []))
        rows = len(cache["table"].get("rows", []))
        return f"table {cols}×{rows}"
    if cache.get("markdown") is not None:
        return "markdown"
    return "—"


def _use(args: argparse.Namespace) -> int:
    cfg = load_config()
    cfg.default_dashboard = args.dashboard_id
    save_config(cfg)
    print_success(f"Default dashboard set to {args.dashboard_id}.")
    return 0


__all__ = ["BUILTIN_TEMPLATES", "CMD_HELP", "CMD_NAME", "register"]