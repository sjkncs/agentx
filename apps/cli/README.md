# df — DataFoundry command-line interface

`df` orchestrates DataFoundry resources from any terminal — notebooks, dashboards,
runs, and upgrades. It's the same surface the web workbench exposes, wrapped in
discoverable shell commands.

## Install

```bash
pip install -e apps/cli
```

This registers the `df` console script (and the `df-cli` alias). The CLI is
self-contained: it does **not** depend on PyQt6 — it uses `httpx` + `rich` only.

## Commands

```text
df init                     Configure API URL + store token in OS keyring
df status                   Show workspace + current user
df doctor                   Run environment diagnostics
df notebook list            List saved notebooks
df notebook show <id>       Print a notebook as JSON
df notebook create --title "..."   Create a new notebook
df notebook run <id>        Trigger a server-side run for every SQL/Python cell
df notebook runs <id>       List the cell-run audit log
df notebook export <id>     Export a notebook as Markdown or JSON
df dashboard list           List saved dashboards
df dashboard apply <tpl>    Apply a built-in template to the current dashboard
df dashboard show <id>      Print a dashboard as JSON
df dashboard export <id>    Export a dashboard as Markdown or JSON
df dashboard refresh <id>   Force-refresh all widgets bound to a real datasource
df run <session-id>         Tail a session log (streaming)
df upgrade                  Self-update check (informational)
df --version                Print CLI version
df help <cmd>               Detailed help for one command
```

## Configuration

Configuration lives at the platform-specific user dir (see
`platformdirs.user_config_dir("df-cli")`):

- Linux: `~/.config/df-cli/config.yaml`
- macOS: `~/Library/Application Support/df-cli/config.yaml`
- Windows: `%APPDATA%\df-cli\config.yaml`

The API token is stored separately in the OS keyring under service
`df-cli` and user `<email>` — `df init` writes it; subsequent calls
read it transparently.

## Development

```bash
cd apps/cli
pip install -e .[dev]
pytest -q
```