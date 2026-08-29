"""`df` — AgentX CLI.

The package exposes a single entry point in `app.main`. Subcommands live in
`df_cli.commands.*` so they can also be invoked programmatically via
`df_cli.commands.notebook.run(...)`.
"""

from __future__ import annotations

__version__ = "0.1.0"
__all__ = ["__version__"]