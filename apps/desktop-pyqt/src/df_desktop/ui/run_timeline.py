"""Run timeline strip.

Horizontal list of step chips that mirror the AG-UI event stream. Used as a
filter driver for the 3D trajectory canvas: clicking a chip centres the
graph on that node.
"""

from __future__ import annotations

from dataclasses import dataclass

from pyqtgraph.Qt import QtCore, QtGui
from pyqtgraph.Qt.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from ..ui.theme import Theme, step_color


@dataclass
class TimelineStep:
    index: int
    label: str
    kind: str
    status: str


class RunTimeline(QWidget):
    """Horizontal scrolling step strip."""

    step_selected = QtCore.Signal(int)

    def __init__(self, theme: Theme, parent=None) -> None:
        super().__init__(parent=parent)
        self._theme = theme
        self._buttons: list[QPushButton] = []

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 0, 12, 0)
        layout.setSpacing(4)

        title = QLabel(self.tr("Run timeline"), self)
        title.setStyleSheet(f"color: {theme.muted}; font-size: 11px;")
        layout.addWidget(title)

        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.Shape.NoFrame)
        scroll.setVerticalScrollBarPolicy(QtCore.Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setFixedHeight(48)
        layout.addWidget(scroll)

        container = QWidget(scroll)
        container_layout = QHBoxLayout(container)
        container_layout.setContentsMargins(0, 0, 0, 0)
        container_layout.setSpacing(6)
        container_layout.addStretch(1)
        scroll.setWidget(container)
        self._strip_layout = container_layout

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def set_steps(self, steps: list[TimelineStep]) -> None:
        # Remove existing chips.
        for button in self._buttons:
            self._strip_layout.removeWidget(button)
            button.deleteLater()
        self._buttons = []

        for step in steps:
            button = QPushButton(f"{step.index + 1}. {step.label}", self)
            colour = step_color(self._theme, step.kind)
            button.setStyleSheet(
                f"QPushButton {{"
                f"  background: {self._theme.surface};"
                f"  color: {self._theme.foreground};"
                f"  border: 1px solid {self._theme.border};"
                f"  border-left: 3px solid {colour};"
                f"  border-radius: 6px;"
                f"  padding: 4px 10px;"
                f"  font-size: 11px;"
                f"  text-align: left;"
                f"}}"
                f"QPushButton:hover {{ background: {self._theme.surface_subtle}; }}"
            )
            button.clicked.connect(lambda _checked=False, i=step.index: self.step_selected.emit(i))
            self._strip_layout.insertWidget(self._strip_layout.count() - 1, button)
            self._buttons.append(button)


__all__ = ["RunTimeline", "TimelineStep"]


# Re-export so callers that use QtWidgets directly don't need extra imports.
_ = (QHBoxLayout, QVBoxLayout, QtCore, QtGui)