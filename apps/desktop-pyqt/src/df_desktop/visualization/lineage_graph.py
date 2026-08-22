"""3D lineage graph viewer (DataLink).

Tables, columns, concepts, and entities are positioned by `radial_layout` so
the focal entity sits at the centre and connected nodes form concentric
rings. Edge weight drives edge thickness; edge kind drives colour.
"""

from __future__ import annotations

import numpy as np
from PyQt6.QtGui import QColor

from ..api.schemas import DatalinkGraph
from ..ui.theme import Theme
from .gl_canvas import GLGraphCanvas


EDGE_COLOURS = {
    "FOREIGN_KEY": QColor(110, 110, 110, 200),
    "JOINABLE": QColor(80, 130, 200, 200),
    "REPRESENTS": QColor(180, 110, 220, 200),
    "HAS_CONCEPT": QColor(60, 180, 110, 200),
    "SEMANTIC_SYNONYM": QColor(220, 180, 60, 200),
    "CORRELATED": QColor(60, 200, 200, 200),
    "DISTRIBUTION_SIMILAR": QColor(200, 60, 110, 200),
}


NODE_COLOURS = {
    "table": "#3f769b",
    "column": "#635c8e",
    "concept": "#3f7480",
    "entity": "#3f7d63",
}


class LineageGraphCanvas(GLGraphCanvas):
    """GL canvas specialised for `DatalinkGraph`."""

    def __init__(self, theme: Theme, parent=None) -> None:
        super().__init__(background=theme.background, parent=parent)
        self._theme = theme

    def render_graph(self, graph: DatalinkGraph, *, focus: str | None = None) -> None:
        if not graph.nodes:
            self.set_graph(coords=np.zeros((0, 3), dtype=np.float32), node_colors=[])
            return

        node_ids = [n.id for n in graph.nodes]
        edges = [(e.from_, e.to) for e in graph.edges]
        root = focus if focus in node_ids else node_ids[0]
        coords = self.coords_radial(node_ids, edges, root=root)

        colours = [self._colour_for(node.kind) for node in graph.nodes]
        sizes = [self._size_for(node.kind) for node in graph.nodes]
        edge_index = {(e.from_, e.to): e for e in graph.edges}
        edge_colours = [
            EDGE_COLOURS.get(edge_index.get((src, dst), edge_index.get((dst, src))).kind if (src, dst) in edge_index or (dst, src) in edge_index else None, QColor(120, 120, 130, 160))
            for src, dst in self._index_pairs(node_ids, edges)
        ]

        self.set_graph(
            coords=coords,
            node_colors=colours,
            node_sizes=sizes,
            edges=self._index_pairs(node_ids, edges),
            edge_colors=edge_colours,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _colour_for(self, kind: str) -> QColor:
        return QColor(NODE_COLOURS.get(kind, "#4d6f96"))

    @staticmethod
    def _size_for(kind: str) -> float:
        return {
            "table": 14.0,
            "column": 7.0,
            "concept": 9.0,
            "entity": 11.0,
        }.get(kind, 8.0)

    @staticmethod
    def _index_pairs(node_ids: list[str], edges: list[tuple[str, str]]) -> list[tuple[int, int]]:
        index = {nid: i for i, nid in enumerate(node_ids)}
        pairs: list[tuple[int, int]] = []
        for src, dst in edges:
            if src in index and dst in index:
                pairs.append((index[src], index[dst]))
        return pairs


__all__ = ["LineageGraphCanvas", "EDGE_COLOURS", "NODE_COLOURS"]


# Silence unused import warnings for callers that don't use numpy directly.
_ = np