"""Subcommand implementations for `df`.

Each module exposes a `register(subparsers)` function that contributes one or
more subcommands to the top-level argparse parser. Keeping every command as a
plain function means tests can call them directly without spawning a process.
"""

from __future__ import annotations

from . import dashboard, doctor, init, notebook, run, status, upgrade

__all__ = ["dashboard", "doctor", "init", "notebook", "run", "status", "upgrade"]