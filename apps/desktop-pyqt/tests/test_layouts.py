"""3D layout helpers — pure numpy, no Qt needed."""

from __future__ import annotations

import math

import numpy as np

from df_desktop.visualization.layout import (
    hierarchical_layout,
    radial_layout,
    spring_layout,
)


def _close(a: float, b: float, *, abs_tol: float = 1e-6) -> bool:
    return math.isclose(a, b, abs_tol=abs_tol)


def test_hierarchical_layout_layers() -> None:
    nodes = ["root", "a", "b", "c"]
    edges = [("root", "a"), ("root", "b"), ("a", "c")]
    coords = hierarchical_layout(nodes, edges, root="root")
    assert coords.shape == (4, 3)
    y_values = {nid: float(coords[i, 1]) for i, nid in enumerate(nodes)}
    # root sits at y == 0, its children at y == -layer_gap, c deeper.
    assert _close(y_values["root"], 0.0)
    assert _close(y_values["a"], y_values["b"])
    assert y_values["c"] < y_values["a"]


def test_radial_layout_rings() -> None:
    nodes = ["a", "b", "c"]
    edges = [("a", "b"), ("a", "c")]
    coords = radial_layout(nodes, edges, root="a")
    assert coords.shape == (3, 3)
    distances = np.linalg.norm(coords, axis=1)
    assert _close(float(distances[0]), 0.0)  # 'a'
    assert float(distances[1]) > 0.0  # 'b'
    assert float(distances[2]) > 0.0  # 'c'


def test_spring_layout_is_finite() -> None:
    nodes = [f"n{i}" for i in range(20)]
    edges = [(nodes[i], nodes[(i + 1) % len(nodes)]) for i in range(len(nodes))]
    coords = spring_layout(nodes, edges, iterations=20, seed=42)
    assert coords.shape == (20, 3)
    assert bool(np.isfinite(coords).all())


if __name__ == "__main__":
    test_hierarchical_layout_layers()
    test_radial_layout_rings()
    test_spring_layout_is_finite()
    print("ok")