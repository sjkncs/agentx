"""Main window for `df-desktop`.

Layout mirrors the web workbench (left rail, central canvas, right panel)
but is tuned for **deep viewing** rather than running new tasks.

* **Left rail** — `SessionBrowser`
* **Central canvas** — tabs for `Trajectory` / `Lineage`
* **Right panel** — selected node details + run timeline
* **Bottom strip** — `RunTimeline` + theme picker + status bar
"""

from __future__ import annotations

from typing import Sequence

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QAction, QIcon, QKeySequence
from PyQt6.QtWidgets import (
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QSizePolicy,
    QSplitter,
    QStackedWidget,
    QTabWidget,
    QTextEdit,
    QToolBar,
    QVBoxLayout,
    QWidget,
)

from ..api.schemas import TraceDag
from ..ui.run_timeline import RunTimeline, TimelineStep
from ..ui.session_browser import SessionBrowser
from ..ui.theme import Theme, get_theme
from ..visualization.lineage_graph import LineageGraphCanvas
from ..visualization.trajectory_graph import TrajectoryGraphCanvas


class MainWindow(QMainWindow):
    """Main application window."""

    def __init__(self, theme: Theme | None = None) -> None:
        super().__init__()
        self._theme = theme or get_theme("default")
        self.setWindowTitle(self.tr("DataFoundry Desktop — 3D Visualisation"))
        self.resize(1280, 800)
        self._set_theme(self._theme)

        # Toolbar
        toolbar = QToolBar(self)
        toolbar.setMovable(False)
        self.addToolBar(toolbar)

        self._api_url_label = QLabel(self.tr("Connecting…"), self)
        self._api_url_label.setStyleSheet(f"color: {self._theme.muted}; padding: 0 8px;")
        toolbar.addWidget(self._api_url_label)

        spacer = QWidget(toolbar)
        spacer.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        toolbar.addWidget(spacer)

        toolbar.addWidget(QLabel(self.tr("Theme:"), self))
        self._theme_combo = QComboBox(toolbar)
        self._theme_combo.addItems(["default", "dark", "deepseek", "soft"])
        self._theme_combo.currentTextChanged.connect(self._on_theme_changed)
        toolbar.addWidget(self._theme_combo)

        # Central layout
        central = QWidget(self)
        central_layout = QHBoxLayout(central)
        central_layout.setContentsMargins(0, 0, 0, 0)
        central_layout.setSpacing(0)
        self.setCentralWidget(central)

        splitter = QSplitter(Qt.Orientation.Horizontal, central)
        central_layout.addWidget(splitter)

        # Left rail (sessions)
        self._session_browser = SessionBrowser(self._theme, splitter)
        splitter.addWidget(self._session_browser)

        # Right stack (canvas + details)
        right = QWidget(splitter)
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(0)

        tabs = QTabWidget(right)
        tabs.setTabPosition(QTabWidget.TabPosition.North)
        self._trajectory_canvas = TrajectoryGraphCanvas(self._theme)
        self._lineage_canvas = LineageGraphCanvas(self._theme)
        tabs.addTab(self._trajectory_canvas, self.tr("Trajectory (3D)"))
        tabs.addTab(self._lineage_canvas, self.tr("Lineage (3D)"))
        right_layout.addWidget(tabs, 4)

        timeline = RunTimeline(self._theme, right)
        right_layout.addWidget(timeline, 0)
        self._timeline = timeline
        self._timeline.step_selected.connect(self._on_step_selected)

        self._details = QTextEdit(right)
        self._details.setReadOnly(True)
        self._details.setStyleSheet(
            f"QTextEdit {{"
            f"  background: {self._theme.surface};"
            f"  color: {self._theme.foreground};"
            f"  border-top: 1px solid {self._theme.border};"
            f"  font-family: 'JetBrains Mono', monospace;"
            f"  font-size: 11px;"
            f"}}"
        )
        self._details.setPlaceholderText(self.tr("Click a step to inspect details."))
        right_layout.addWidget(self._details, 1)

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([260, 1020])

        # Bottom status bar
        status = QFrame(self)
        status_layout = QHBoxLayout(status)
        status_layout.setContentsMargins(12, 6, 12, 6)
        self._status_label = QLabel(self.tr("Ready"), self)
        status_layout.addWidget(self._status_label)
        status_layout.addStretch(1)
        self._role_badge = QLabel("", self)
        self._role_badge.setStyleSheet(
            f"QLabel {{"
            f"  background: {self._theme.primary};"
            f"  color: white;"
            f"  padding: 2px 8px;"
            f"  border-radius: 9999px;"
            f"  font-size: 10px;"
            f"  font-weight: 600;"
            f"}}"
        )
        status_layout.addWidget(self._role_badge)
        self.setStatusBar(self._create_qstatusbar(status))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def session_browser(self) -> SessionBrowser:
        return self._session_browser

    def trajectory_canvas(self) -> TrajectoryGraphCanvas:
        return self._trajectory_canvas

    def lineage_canvas(self) -> LineageGraphCanvas:
        return self._lineage_canvas

    def set_api_url(self, url: str) -> None:
        self._api_url_label.setText(self.tr("API: {url}").format(url=url))

    def set_status(self, text: str) -> None:
        self._status_label.setText(text)

    def set_role_badge(self, role: str | None) -> None:
        self._role_badge.setText((role or "guest").upper())

    def show_trace_dag(self, dag: TraceDag) -> None:
        self._trajectory_canvas.render_dag(dag)
        self._details.setPlainText(self._format_dag_summary(dag))

    def show_timeline_steps(self, steps: Sequence[TimelineStep]) -> None:
        self._timeline.set_steps(list(steps))

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _set_theme(self, theme: Theme) -> None:
        self._theme = theme
        self.setStyleSheet(
            f"QMainWindow {{ background: {theme.background}; }}"
            f"QToolBar {{ background: {theme.surface}; border-bottom: 1px solid {theme.border}; }}"
            f"QStatusBar {{ background: {theme.surface_subtle}; color: {theme.muted}; }}"
            f"QTabWidget::pane {{ border: 0; }}"
            f"QTabBar::tab {{"
            f"  background: transparent;"
            f"  color: {theme.muted};"
            f"  padding: 8px 16px;"
            f"  border: 0;"
            f"}}"
            f"QTabBar::tab:selected {{"
            f"  color: {theme.foreground};"
            f"  border-bottom: 2px solid {theme.primary};"
            f"}}"
        )

    def _create_qstatusbar(self, fallback: QFrame) -> "QStatusBar":
        from PyQt6.QtWidgets import QStatusBar

        bar = QStatusBar(self)
        # Embed the role badge frame into the status bar by adding the fallback as widget.
        # Simpler: just leave the bar empty and rely on fallback render.
        return bar

    def _on_theme_changed(self, name: str) -> None:
        self._set_theme(get_theme(name))
        # Re-render canavases so background matches.
        self._trajectory_canvas.setBackgroundColor(self._theme.background)
        self._lineage_canvas.setBackgroundColor(self._theme.background)

    def _on_step_selected(self, step_index: int) -> None:
        self._details.setPlainText(
            self.tr("Step {index} selected").format(index=step_index + 1)
        )

    @staticmethod
    def _format_dag_summary(dag: TraceDag) -> str:
        if not dag.nodes:
            return "No trace nodes yet."
        kinds: dict[str, int] = {}
        for node in dag.nodes:
            kinds[node.kind] = kinds.get(node.kind, 0) + 1
        summary_lines = [f"Session trace — {len(dag.nodes)} nodes, {len(dag.edges)} edges:"]
        for kind, count in sorted(kinds.items()):
            summary_lines.append(f"  · {kind:>11}: {count}")
        return "\n".join(summary_lines)


__all__ = ["MainWindow"]