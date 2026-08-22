"""Left-hand session / run browser.

Lists every session the user owns with a live filter, status dot, and
"Load trace" action. Designed to be embedded in the main window's left rail.
"""

from __future__ import annotations

from dataclasses import dataclass

from pyqtgraph.Qt import QtCore, QtGui
from pyqtgraph.Qt.QtWidgets import (
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..api.schemas import Session
from ..ui.theme import Theme


@dataclass
class SessionEntry:
    session: Session
    status_label: str = ""


class SessionBrowser(QWidget):
    """Filterable list of sessions, emits `session_selected(session_id)`."""

    session_selected = QtCore.Signal(str)

    def __init__(self, theme: Theme, parent=None) -> None:
        super().__init__(parent=parent)
        self._theme = theme
        self.setObjectName("session-browser")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        self._title = QLabel(self.tr("Sessions"), self)
        self._title.setStyleSheet(
            f"color: {theme.foreground}; font-weight: 600; font-size: 13px;"
        )
        layout.addWidget(self._title)

        self._search = QLineEdit(self)
        self._search.setPlaceholderText(self.tr("Search by title…"))
        self._search.setClearButtonEnabled(True)
        self._search.textChanged.connect(self._apply_filter)
        layout.addWidget(self._search)

        self._list = QListWidget(self)
        self._list.setStyleSheet(
            "QListWidget {"
            f"  background: {theme.surface}; color: {theme.foreground};"
            f"  border: 1px solid {theme.border}; border-radius: 8px;"
            "  padding: 4px;"
            "}"
            "QListWidget::item { padding: 6px 8px; border-radius: 6px; }"
            f"QListWidget::item:selected {{ background: {theme.primary}; color: white; }}"
            "QListWidget::item:hover { background: rgba(0,0,0,0.04); }"
        )
        self._list.currentItemChanged.connect(self._on_selection_changed)
        layout.addWidget(self._list, 1)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def set_sessions(self, sessions: list[Session]) -> None:
        self._list.clear()
        for session in sessions:
            item = QListWidgetItem(session.title or session.id)
            item.setData(QtCore.Qt.ItemDataRole.UserRole, session.id)
            tooltip = session.title or session.id
            if session.created_at:
                tooltip += f"\nCreated: {session.created_at}"
            item.setToolTip(tooltip)
            self._list.addItem(item)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------
    def _apply_filter(self, query: str) -> None:
        needle = query.strip().lower()
        for i in range(self._list.count()):
            item = self._list.item(i)
            assert item is not None
            item.setHidden(bool(needle) and needle not in item.text().lower())

    def _on_selection_changed(
        self,
        current: QListWidgetItem | None,
        _previous: QListWidgetItem | None,
    ) -> None:
        if current is None:
            return
        session_id = current.data(QtCore.Qt.ItemDataRole.UserRole)
        if isinstance(session_id, str):
            self.session_selected.emit(session_id)


__all__ = ["SessionBrowser", "SessionEntry"]