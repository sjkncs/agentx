"""Terminal presentation helpers shared by every command.

We isolate Rich imports here so that headless CI / packaging can import
subcommand modules without forcing a Rich requirement (Rich is in our
`dependencies` block but keeping the surface small helps tests).
"""

from __future__ import annotations

import json
from typing import Any

try:
    from rich.console import Console
    from rich.table import Table

    _HAS_RICH = True
except Exception:  # pragma: no cover - extremely defensive
    _HAS_RICH = False

if _HAS_RICH:
    console = Console()
else:  # pragma: no cover
    console = None  # type: ignore[assignment]


def print_error(message: str) -> None:
    if console is not None:
        console.print(f"[bold red]✗[/bold red] {message}")
    else:
        print(f"ERROR: {message}")


def print_success(message: str) -> None:
    if console is not None:
        console.print(f"[bold green]✓[/bold green] {message}")
    else:
        print(message)


def print_info(message: str) -> None:
    if console is not None:
        console.print(f"[cyan]•[/cyan] {message}")
    else:
        print(message)


def render_table(headers: list[str], rows: list[list[Any]]) -> None:
    if console is None:
        widths = [max(len(str(h)), *(len(str(r[i])) for r in rows)) if rows else len(h) for i, h in enumerate(headers)]
        print("\t".join(str(h).ljust(widths[i]) for i, h in enumerate(headers)))
        for row in rows:
            print("\t".join(str(c).ljust(widths[i]) for i, c in enumerate(row)))
        return
    table = Table(show_header=True, header_style="bold")
    for h in headers:
        table.add_column(h)
    for row in rows:
        table.add_row(*(str(c) for c in row))
    console.print(table)


def render_json(payload: Any) -> None:
    # Use a plain JSON dump rather than `console.print_json` so test capture
    # mode (and pipe consumers like `jq`) get parseable output without any
    # Rich-formatted ANSI framing.
    print(json.dumps(payload, indent=2, ensure_ascii=False))


__all__ = [
    "console",
    "print_error",
    "print_info",
    "print_json",
    "render_json",
    "render_table",
    "print_success",
]