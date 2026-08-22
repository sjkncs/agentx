"""3D GL canvas based on `pyqtgraph.opengl`.

`GLGraphCanvas` is a generic node/edge viewer used by both the trajectory
graph and the lineage graph. Concrete subclasses provide:

* the data source (a `TraceDag` or a `DatalinkGraph`), and
* the colour mapping per node.
"""

from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np
import pyqtgraph as pg
from PyQt6.QtCore import QSize, Qt
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import QSizePolicy
from pyqtgraph.opengl import (
    GLGridItem,
    GLLinePlotItem,
    GLMeshItem,
    GLScatterPlotItem,
    GLViewWidget,
)

from .layout import hierarchical_layout, radial_layout, spring_layout


class GLGraphCanvas(GLViewWidget):
    """Reusable 3D viewer for node/edge graphs."""

    def __init__(
        self,
        *,
        background: str = "#1a1d24",
        grid: bool = True,
        parent=None,
    ) -> None:
        super().__init__(parent=parent)
        self.setBackgroundColor(background)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.setCameraPosition(distance=40)

        self._scatter: GLScatterPlotItem | None = None
        self._lines: list[GLLinePlotItem] = []
        self._edges: list[tuple[int, int]] = []
        self._node_count = 0

        if grid:
            grid_item = GLGridItem()
            grid_item.setSize(40, 40, 40)
            grid_item.setSpacing(2, 2, 2)
            grid_item.translate(0, -2, 0)
            self.addItem(grid_item)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def set_graph(
        self,
        *,
        coords: np.ndarray,
        node_colors: Sequence[QColor],
        node_sizes: Sequence[float] | None = None,
        edges: Sequence[tuple[int, int]] = (),
        edge_colors: Sequence[QColor] | None = None,
    ) -> None:
        """Replace the displayed graph in-place."""
        self.clear()

        if coords.size == 0:
            self._scatter = None
            self._lines = []
            return

        sizes = np.asarray(node_sizes or [8.0] * len(coords), dtype=np.float32)
        self._scatter = GLScatterPlotItem(
            pos=coords.astype(np.float32),
            color=node_colors,
            size=sizes,
            pxMode=True,
        )
        self.addItem(self._scatter)

        self._edges = list(edges)
        self._lines = []
        if self._edges:
            edge_color = edge_colors or [QColor(120, 120, 130, 160)] * len(self._edges)
            for (src, dst), colour in zip(self._edges, edge_color):
                line = GLLinePlotItem(
                    pos=np.vstack([coords[src], coords[dst]]),
                    color=colour,
                    width=1.2,
                    antialias=True,
                )
                self.addItem(line)
                self._lines.append(line)
        self._node_count = len(coords)
        # Re-center the camera on the new bounds.
        self.setCameraPosition(distance=max(40.0, float(coords.max()) * 1.4))

    # ------------------------------------------------------------------
    # Convenience constructors for subclasses
    # ------------------------------------------------------------------
    @staticmethod
    def coords_hierarchical(node_ids: Sequence, edges: Iterable, root=None) -> np.ndarray:
        return hierarchical_layout(list(node_ids), list(edges), root=root)

    @staticmethod
    def coords_radial(node_ids: Sequence, edges: Iterable, root=None) -> np.ndarray:
        return radial_layout(list(node_ids), list(edges), root=root)

    @staticmethod
    def coords_spring(node_ids: Sequence, edges: Iterable, *, seed: int = 0) -> np.ndarray:
        return spring_layout(list(node_ids), list(edges), seed=seed)


__all__ = ["GLGraphCanvas"]


# Helper used by callers that want a ready-made colour sequence.
def color_sequence(rgba_values: Iterable[tuple[int, int, int, int]]) -> list[QColor]:
    return [QColor(*c) for c in rgba_values]


_ = GLMeshItem  # re-export to silence unused-import warnings for callers