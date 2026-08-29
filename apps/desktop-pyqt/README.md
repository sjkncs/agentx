# df-desktop

PyQt6 desktop client for AgentX — a focused, scientific-grade 3D browser
for agent trajectories and data lineage.

> **Why a separate desktop app?** The web workbench is optimised for
> keyboard-fast task running. `df-desktop` is optimised for **deep, exploratory
> viewing** of completed runs: 3D trace DAG, lineage graph, run timelines,
> scatter views of tool invocations, and a holographic view of the LATS
> search tree.

## Highlights

- **3D Trajectory Browser** — every tool call, artifact, and decision in a run,
  laid out in 3D space. Drag, zoom, filter by step kind, click to inspect.
- **3D Lineage Graph** — table / column / concept graph from DataLink,
  rendered in the same GL widget.
- **Run Timeline** — playback control for the AG-UI event stream; scrub
  through a run while the 3D view re-animates.
- **Workspace picker** — connect to any AgentX API instance (local,
  LAN, or remote), with secure credential storage via `keyring`.
- **Theme aware** — follows the same neutral / dark / deepseek / soft palette
  as the web app.

## Install

```bash
# from the repo root
cd apps/desktop-pyqt
pip install -e ".[dev]"

# launch
df-desktop
# or:
df-vis
```

`df-desktop` opens the full app shell; `df-vis` jumps straight into the
3D visualisation for a single session.

## Project layout

```
apps/desktop-pyqt/
├── pyproject.toml
├── README.md
├── src/df_desktop/
│   ├── __init__.py
│   ├── __main__.py
│   ├── app.py               # QApplication bootstrap
│   ├── api/                 # thin httpx wrapper around the AgentX REST API
│   │   ├── client.py
│   │   └── schemas.py
│   ├── config/              # paths, settings, keyring helpers
│   │   └── settings.py
│   ├── ui/                  # Qt widgets, layouts, main window
│   │   ├── main_window.py
│   │   ├── session_browser.py
│   │   ├── run_timeline.py
│   │   └── theme.py
│   └── visualization/       # 3D GL widgets
│       ├── gl_canvas.py
│       ├── trajectory_graph.py
│       ├── lineage_graph.py
│       └── layout.py        # force-directed + hierarchical layouts
└── tests/
    ├── test_api.py
    └── test_visualization.py
```

## Connecting to a workspace

`df-desktop` reads connection settings from `~/.df-desktop/config.yaml`:

```yaml
api_url: http://127.0.0.1:8797
default_session: sched-sched_msqzs92j_3rj6ef-msqztuyu
```

Login happens inside the app — credentials are stored in the OS keyring
(`keyring.get_password("df-desktop", "<email>")`).

## License

MIT.