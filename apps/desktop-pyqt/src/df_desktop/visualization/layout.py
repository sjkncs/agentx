"""3D layout helpers.

We avoid bringing in `networkx` so the desktop client stays small. The
following routines implement:

* `hierarchical_layout` — top-down layered layout by graph depth.
* `radial_layout` — concentric rings around a root (used for lineage).
* `spring_layout` — a tiny Fruchterman-Reingold style relaxation, with the
  graph treated as a physical system (good enough for ≤ 5 000 nodes).

All functions return numpy arrays of shape `(N, 3)`. Inputs are a list of
edges `(src, dst)` plus an optional list of node ids; when the node list is
omitted the union of edge endpoints is used.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Hashable

import numpy as np

Node = Hashable
Edge = tuple[Node, Node]


def _build_adjacency(
    nodes: Sequence[Node],
    edges: Iterable[Edge],
) -> tuple[dict[Node, int], list[list[int]]]:
    index = {nid: i for i, nid in enumerate(nodes)}
    adjacency: list[list[int]] = [[] for _ in nodes]
    for src, dst in edges:
        if src not in index or dst not in index:
            continue
        adjacency[index[src]].append(index[dst])
        adjacency[index[dst]].append(index[src])
    return index, adjacency


def hierarchical_layout(
    nodes: Sequence[Node],
    edges: Sequence[Edge],
    *,
    root: Node | None = None,
    layer_gap: float = 4.0,
) -> np.ndarray:
    """Top-down layered 3D layout, computed by BFS depth."""
    index, adjacency = _build_adjacency(nodes, edges)
    n = len(nodes)
    if n == 0:
        return np.zeros((0, 3), dtype=np.float32)

    depths = np.full(n, -1, dtype=np.int32)
    start = root if root in index else (nodes[0] if n else None)
    if start is None:
        return np.zeros((n, 3), dtype=np.float32)

    queue = [index[start]]
    depths[queue[0]] = 0
    head = 0
    while head < len(queue):
        u = queue[head]
        head += 1
        for v in adjacency[u]:
            if depths[v] == -1:
                depths[v] = depths[u] + 1
                queue.append(v)
    # Any node never reached (disconnected) — give it the max depth.
    unreachable = np.where(depths == -1)[0]
    if unreachable.size:
        depths[unreachable] = int(depths.max(initial=0)) + 1 if depths.max(initial=-1) >= 0 else 0

    coords = np.zeros((n, 3), dtype=np.float32)
    # Place nodes along y (depth axis), spread evenly along x within each layer.
    layer_indices: dict[int, list[int]] = {}
    for i, d in enumerate(depths):
        layer_indices.setdefault(int(d), []).append(i)
    for layer, indices in layer_indices.items():
        m = len(indices)
        for j, idx in enumerate(indices):
            x = (j - (m - 1) / 2) * layer_gap
            z = 0.0
            y = -float(layer) * layer_gap
            coords[idx] = (x, y, z)
    return coords


def radial_layout(
    nodes: Sequence[Node],
    edges: Sequence[Edge],
    *,
    root: Node | None = None,
    ring_gap: float = 3.0,
) -> np.ndarray:
    """Place nodes on concentric rings around a root, distance = BFS depth."""
    index, adjacency = _build_adjacency(nodes, edges)
    n = len(nodes)
    if n == 0:
        return np.zeros((0, 3), dtype=np.float32)

    start = root if root in index else nodes[0]
    distances = np.full(n, -1, dtype=np.int32)
    distances[index[start]] = 0
    queue = [index[start]]
    head = 0
    while head < len(queue):
        u = queue[head]
        head += 1
        for v in adjacency[u]:
            if distances[v] == -1:
                distances[v] = distances[u] + 1
                queue.append(v)
    unreachable = np.where(distances == -1)[0]
    if unreachable.size:
        distances[unreachable] = int(distances.max(initial=0)) + 1

    coords = np.zeros((n, 3), dtype=np.float32)
    rings: dict[int, list[int]] = {}
    for i, d in enumerate(distances):
        rings.setdefault(int(d), []).append(i)
    for ring, indices in rings.items():
        radius = float(ring) * ring_gap
        m = len(indices)
        for j, idx in enumerate(indices):
            angle = (j / max(m, 1)) * 2 * np.pi
            coords[idx] = (radius * np.cos(angle), 0.0, radius * np.sin(angle))
    return coords


def spring_layout(
    nodes: Sequence[Node],
    edges: Sequence[Edge],
    *,
    iterations: int = 120,
    k: float | None = None,
    seed: int = 0,
) -> np.ndarray:
    """Tiny Fruchterman-Reingold relaxation, lifted to 3D."""
    rng = np.random.default_rng(seed)
    n = len(nodes)
    if n == 0:
        return np.zeros((0, 3), dtype=np.float32)

    index, adjacency = _build_adjacency(nodes, edges)
    pos = rng.normal(0.0, 1.0, size=(n, 3)).astype(np.float32)
    if k is None:
        area = float(max(n, 1))
        k = np.sqrt(area / n) * 2.0

    a = np.array(adjacency, dtype=object)
    for _ in range(iterations):
        delta = pos[:, None, :] - pos[None, :, :]  # (N, N, 3)
        dist = np.linalg.norm(delta, axis=2)
        np.fill_diagonal(dist, np.inf)
        # Repulsion
        strength = (k * k) / np.where(dist == 0, 1e-6, dist)
        force = np.einsum("ij,ijk->ik", strength, delta)
        # Attraction along edges
        for u_idx, neighbours in enumerate(a):
            if len(neighbours) == 0:
                continue
            v_idx = np.asarray(neighbours, dtype=np.int32)
            diff = pos[v_idx] - pos[u_idx]
            d = np.linalg.norm(diff, axis=1)
            np.maximum(d, 1e-6, out=d)
            attraction = (d * d) / k
            force[u_idx] -= np.sum(attraction[:, None] * (diff / d[:, None]), axis=0)
            for v, attr, dv in zip(v_idx, attraction, diff):
                force[v] += attr * (dv / max(np.linalg.norm(dv), 1e-6))
        # Limit displacement
        max_d = k * 0.1
        length = np.linalg.norm(force, axis=1)
        scale = np.minimum(1.0, max_d / np.maximum(length, 1e-6))
        pos += force * scale[:, None]

    return pos.astype(np.float32)


__all__ = [
    "Edge",
    "Node",
    "hierarchical_layout",
    "radial_layout",
    "spring_layout",
]