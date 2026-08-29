"""3D trajectory graph viewer.

Renders a `TraceDag` from the AgentX API:

* each node = a tool call, branch decision, artifact, or message turn,
* edges = `branches_from | continues_to | emits | produces_artifact | starts_run`,
* colour by step kind using the same palette as the web workbench,
* size scales with node "weight" (heuristic from detail payload).

The viewer also exposes a `TimelineScrubber` so users can filter the visible
graph by AG-UI event time.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np
from PyQt6.QtCore import QObject, Qt, pyqtSignal
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import QSlider
from pyqtgraph.opengl import GLViewWidget

from ..api.schemas import TraceDag
from ..ui.theme import Theme, step_color
from .gl_canvas import GLGraphCanvas


@dataclass
class TrajectoryNode:
    """Lightweight projection of a trace node for the 3D viewer."""

    id: str
    kind: str
    label: str
    status: str
    weight: float = 1.0
    created_at: str | None = None


NODE_KIND_COLOR_KEYS = {
    "tool": "inspect",
    "branch": "knowledge",
    "artifact": "success",
    "context": "fetch",
    "user-turn": "transform",
    "run-start": "query",
    "run-terminal": "visualize",
}


def project_nodes(dag: TraceDag) -> list[TrajectoryNode]:
    """Flatten the API trace DAG into a list of lightweight node records."""
    projected: list[TrajectoryNode] = []
    for node in dag.nodes:
        weight = 1.0
        detail = node.detail or {}
        # Heuristics: row counts for SQL, byte sizes for files, message length for turns.
        for key in ("row_count", "byte_size", "message_length", "tokens", "step_count"):
            value = detail.get(key)
            if isinstance(value, (int, float)) and value > 0:
                weight = max(weight, min(20.0, 1.0 + np.log10(1 + float(value))))
        projected.append(
            TrajectoryNode(
                id=node.id,
                kind=node.kind,
                label=node.summary,
                status=node.status,
                weight=weight,
                created_at=str(detail.get("created_at", "")) or None,
            )
        )
    return projected


def project_edges(dag: TraceDag) -> list[tuple[int, int]]:
    """Translate trace DAG edges into index pairs."""
    index = {n.id: i for i, n in enumerate(dag.nodes)}
    edges: list[tuple[int, int]] = []
    for edge in dag.edges:
        src = index.get(edge.from_)
        dst = index.get(edge.to)
        if src is None or dst is None or src == dst:
            continue
        edges.append((src, dst))
    return edges


def classify_edge_kind(dag: TraceDag) -> list[str]:
    """Return an edge-kind label per projected edge (parallel to `project_edges`)."""
    index = {n.id: i for i, n in enumerate(dag.nodes)}
    kinds: list[str] = []
    for edge in dag.edges:
        if edge.from_ in index and edge.to in index:
            kinds.append(edge.kind)
    return kinds


class TrajectoryGraphCanvas(GLGraphCanvas):
    """Specialised GL canvas that knows how to render a `TraceDag`."""

    def __init__(self, theme: Theme, parent=None) -> None:
        super().__init__(background=theme.background, parent=parent)
        self._theme = theme
        self._current_dag: TraceDag | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def render_dag(self, dag: TraceDag, *, layout: str = "hierarchical") -> None:
        self._current_dag = dag
        nodes = project_nodes(dag)
        if not nodes:
            self.set_graph(coords=np.zeros((0, 3), dtype=np.float32), node_colors=[])
            return

        node_ids = [n.id for n in nodes]
        edges = project_edges(dag)
        if layout == "radial":
            coords = self.coords_radial(node_ids, edges, root=node_ids[0])
        elif layout == "spring":
            coords = self.coords_spring(node_ids, edges)
        else:
            coords = self.coords_hierarchical(node_ids, edges, root=node_ids[0])

        colours = [self._colour_for(n) for n in nodes]
        sizes = [max(6.0, 6.0 + float(n.weight) * 1.2) for n in nodes]
        edge_kinds = classify_edge_kind(dag)
        edge_colours = [self._edge_colour(kind) for kind in edge_kinds]

        self.set_graph(
            coords=coords,
            node_colors=colours,
            node_sizes=sizes,
            edges=edges,
            edge_colors=edge_colours,
        )

    def filter_by_time(self, *, start_index: int, end_index: int) -> None:
        """Hide nodes outside the half-open `[start_index, end_index)` window."""
        if self._current_dag is None:
            return
        dag = self._current_dag
        keep = set(dag.nodes[start_index:end_index])
        nodes = [n for n in dag.nodes if n.id in keep]
        keep_ids = {n.id for n in nodes}
        edges = [
            (i, j)
            for i, n in enumerate(nodes)
            for j, m in enumerate(nodes)
            if any(
                e.from_ == n.id and e.to == m.id for e in dag.edges
            )
        ]
        if not nodes:
            self.set_graph(coords=np.zeros((0, 3), dtype=np.float32), node_colors=[])
            return
        coords = self.coords_hierarchical([n.id for n in nodes], edges, root=nodes[0].id)
        colours = [self._colour_for_kind(n.kind) for n in nodes]
        sizes = [max(6.0, 6.0 + float(self._weight_for(n)) * 1.2) for n in nodes]
        self.set_graph(
            coords=coords,
            node_colors=colours,
            node_sizes=sizes,
            edges=edges,
        )

    # ------------------------------------------------------------------
    # Colour helpers
    # ------------------------------------------------------------------
    def _colour_for(self, node: TrajectoryNode) -> QColor:
        if node.status in {"failed", "error"}:
            return QColor(self._theme.step_error)
        if node.status in {"warning"}:
            return QColor(self._theme.step_warning)
        return self._colour_for_kind(node.kind)

    def _colour_for_kind(self, kind: str) -> QColor:
        key = NODE_KIND_COLOR_KEYS.get(kind, "inspect")
        return QColor(step_color(self._theme, key))

    @staticmethod
    def _edge_colour(kind: str) -> QColor:
        palette = {
            "branches_from": QColor(150, 110, 220, 180),
            "continues_to": QColor(110, 110, 110, 180),
            "emits": QColor(60, 130, 200, 200),
            "produces_artifact": QColor(60, 180, 110, 200),
            "starts_run": QColor(220, 180, 60, 200),
        }
        return palette.get(kind, QColor(120, 120, 130, 160))

    @staticmethod
    def _weight_for(node) -> float:
        detail = node.detail or {}
        for key in ("row_count", "byte_size", "message_length", "tokens", "step_count"):
            value = detail.get(key)
            if isinstance(value, (int, float)) and value > 0:
                return float(value)
        return 1.0


class TimelineScrubber(QObject):
    """Emits `range_changed(start, end)` when the user drags the slider."""

    range_changed = pyqtSignal(int, int)

    def __init__(self, total_steps: int = 0, parent=None) -> None:
        super().__init__(parent=parent)
        self._slider = QSlider(Qt.Orientation.Horizontal, parent=parent)
        self._slider.setMinimum(0)
        self._slider.setMaximum(max(total_steps, 1))
        self._slider.setValue(max(total_steps, 0))
        self._slider.setSingleStep(1)
        self._slider.setPageStep(max(total_steps // 10, 1))
        self._slider.valueChanged.connect(self._on_value_changed)

    def widget(self) -> QSlider:
        return self._slider

    def set_total(self, total: int) -> None:
        self._slider.setMaximum(max(total, 1))
        self._slider.setValue(max(total, 0))

    def _on_value_changed(self, value: int) -> None:
        self.range_changed.emit(0, value + 1)


__all__ = [
    "TrajectoryGraphCanvas",
    "TrajectoryNode",
    "TimelineScrubber",
    "NODE_KIND_COLOR_KEYS",
    "project_nodes",
    "project_edges",
    "classify_edge_kind",
]