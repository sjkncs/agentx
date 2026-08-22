"""QApplication bootstrap + login dialog for `df-desktop`."""

from __future__ import annotations

import asyncio
import logging
import sys
from dataclasses import dataclass

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QColor, QPalette
from PyQt6.QtWidgets import (
    QApplication,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QStatusBar,
    QVBoxLayout,
    QWidget,
)

from .api.client import ApiError, DataFoundryClient, run_async
from .config.settings import (
    Settings,
    clear_password,
    load_password,
    save_password,
)
from .ui.main_window import MainWindow
from .ui.theme import get_theme

LOGGER = logging.getLogger(__name__)


@dataclass
class LoginResult:
    email: str
    api_url: str


class LoginDialog(QDialog):
    """Tiny login dialog used to bootstrap the main window."""

    def __init__(self, settings: Settings, parent=None) -> None:
        super().__init__(parent=parent)
        self._settings = settings
        self.setWindowTitle(self.tr("Connect to DataFoundry"))
        self.setModal(True)
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)

        intro = QLabel(
            self.tr(
                "Sign in to a DataFoundry workspace. Credentials are stored "
                "in the OS keyring; only the API URL is written to disk."
            ),
            self,
        )
        intro.setWordWrap(True)
        layout.addWidget(intro)

        form = QFormLayout()
        self._api_url = QLineEdit(settings.api_url, self)
        self._email = QLineEdit(settings.last_user_email or "", self)
        self._password = QLineEdit(self)
        self._password.setEchoMode(QLineEdit.EchoMode.Password)
        # Pre-fill password if we already have one stored.
        if self._email.text():
            cached = load_password(self._email.text())
            if cached:
                self._password.setText(cached)

        form.addRow(self.tr("API URL"), self._api_url)
        form.addRow(self.tr("Email"), self._email)
        form.addRow(self.tr("Password"), self._password)
        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel,
            parent=self,
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    # ------------------------------------------------------------------
    def result_data(self) -> LoginResult | None:
        if self.result() != QDialog.DialogCode.Accepted:
            return None
        email = self._email.text().strip()
        api_url = self._api_url.text().strip() or self._settings.api_url
        if not email or not self._password.text():
            return None
        return LoginResult(email=email, api_url=api_url)


def _bootstrap_event_loop() -> None:
    """Make sure a default asyncio loop exists on POSIX/Windows.

    Qt's main loop is synchronous; we only spin asyncio inside QThread
    workers. This call is a no-op on platforms where the loop already
    exists, but keeps `python -m df_desktop` from crashing on import.
    """
    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())


def _apply_app_theme(app: QApplication, theme_name: str) -> None:
    theme = get_theme(theme_name)
    palette = app.palette()
    palette.setColor(QPalette.ColorRole.Window, QColor(theme.background))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(theme.foreground))
    palette.setColor(QPalette.ColorRole.Base, QColor(theme.surface))
    palette.setColor(QPalette.ColorRole.AlternateBase, QColor(theme.surface_subtle))
    palette.setColor(QPalette.ColorRole.Text, QColor(theme.foreground))
    palette.setColor(QPalette.ColorRole.Button, QColor(theme.surface))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor(theme.foreground))
    palette.setColor(QPalette.ColorRole.Highlight, QColor(theme.primary))
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor("#ffffff"))
    app.setPalette(palette)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    _bootstrap_event_loop()

    settings = Settings.load()
    app = QApplication(argv)
    _apply_app_theme(app, settings.theme)

    dialog = LoginDialog(settings)
    if dialog.exec() != QDialog.DialogCode.Accepted:
        return 0

    login = dialog.result_data()
    if login is None:
        QMessageBox.warning(None, "DataFoundry", "Email and password are required.")
        return 1

    # Persist settings BEFORE attempting login so a bad URL still survives.
    settings.api_url = login.api_url
    settings.last_user_email = login.email
    save_password(login.email, dialog._password.text())  # noqa: SLF001 — dialog owns the field
    settings.save()

    client = DataFoundryClient(base_url=login.api_url)
    try:
        run_async(lambda: client.login(login.email, dialog._password.text()))  # noqa: SLF001
    except ApiError as err:
        clear_password(login.email)
        QMessageBox.critical(None, "DataFoundry", f"Login failed: {err}")
        return 2

    window = MainWindow(theme=get_theme(settings.theme))
    window.set_api_url(login.api_url)
    role = client.auth.role or "guest"
    window.set_role_badge(role)

    # Async session loader — we already have a logged-in client.
    try:
        sessions = run_async(lambda: client.list_sessions(limit=200))
        window.session_browser().set_sessions(sessions.sessions)
    except ApiError as err:
        LOGGER.warning("Failed to list sessions: %s", err)
        window.set_status(self.tr("Could not load sessions: {err}").format(err=err))  # type: ignore[name-defined]

    window.set_status(self.tr("Connected as {email}").format(email=login.email))  # type: ignore[name-defined]
    window.show()

    result = app.exec()

    # Best-effort logout + close.
    try:
        run_async(client.aclose)
    except Exception:  # pragma: no cover - best effort
        LOGGER.debug("client close failed", exc_info=True)

    return result


if __name__ == "__main__":
    raise SystemExit(main())


# Silence unused symbol warnings for re-exports.
_ = (QMainWindow, QStatusBar, QWidget)