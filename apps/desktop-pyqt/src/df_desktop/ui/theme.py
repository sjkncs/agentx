"""Theme + colour tokens mirroring the web app's design system."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Theme:
    name: str
    background: str
    surface: str
    surface_subtle: str
    border: str
    foreground: str
    muted: str
    muted_light: str
    primary: str
    primary_light: str
    accent: str
    success: str
    warning: str
    error: str
    # Step-kind colours (mirror globals.css on the web).
    step_inspect: str = "#4d6f96"
    step_query: str = "#74628f"
    step_transform: str = "#3f827f"
    step_fetch: str = "#3f769b"
    step_visualize: str = "#635c8e"
    step_knowledge: str = "#3f7480"
    step_success: str = "#3f7d63"
    step_warning: str = "#9a6a30"
    step_error: str = "#a24f49"


DEFAULT = Theme(
    name="default",
    background="#f7f7f8",
    surface="#ffffff",
    surface_subtle="#f7f7f8",
    border="#ececf0",
    foreground="#0d0d0d",
    muted="#4d4d4d",
    muted_light="#8a8a99",
    primary="#0d0d0d",
    primary_light="#3a3a3a",
    accent="#737373",
    success="#3f7d63",
    warning="#9a6a30",
    error="#a24f49",
)


DARK = Theme(
    name="dark",
    background="#0f0f10",
    surface="#18181b",
    surface_subtle="#1f1f23",
    border="#2a2a2e",
    foreground="#f5f5f7",
    muted="#c8c8cf",
    muted_light="#8a8a99",
    primary="#fafafa",
    primary_light="#cfcfcf",
    accent="#a3a3a3",
    success="#79c2a3",
    warning="#d2a766",
    error="#d98580",
)


DEEPSEEK = Theme(
    name="deepseek",
    background="#1a1228",
    surface="#241538",
    surface_subtle="#1a1228",
    border="#2f1f44",
    foreground="#f1eaff",
    muted="#bda5e0",
    muted_light="#8c79b3",
    primary="#9a6cff",
    primary_light="#b69aff",
    accent="#7c5fd9",
    success="#7fd4a3",
    warning="#e3b576",
    error="#e07b76",
)


SOFT = Theme(
    name="soft",
    background="#fbf8f3",
    surface="#fffaef",
    surface_subtle="#f4ecdd",
    border="#e8dcc1",
    foreground="#26221a",
    muted="#5b5243",
    muted_light="#8e8169",
    primary="#3d3324",
    primary_light="#6b5a44",
    accent="#9b8456",
    success="#7d8f5f",
    warning="#a87d4f",
    error="#a85247",
)


THEMES: dict[str, Theme] = {t.name: t for t in (DEFAULT, DARK, DEEPSEEK, SOFT)}


def get_theme(name: str) -> Theme:
    return THEMES.get(name, DEFAULT)


def step_color(theme: Theme, kind: str) -> str:
    """Return the canonical step-kind colour for a given theme."""
    mapping = {
        "inspect": theme.step_inspect,
        "query": theme.step_query,
        "transform": theme.step_transform,
        "fetch": theme.step_fetch,
        "visualize": theme.step_visualize,
        "knowledge": theme.step_knowledge,
        "success": theme.step_success,
        "warning": theme.step_warning,
        "error": theme.step_error,
    }
    return mapping.get(kind, theme.accent)


__all__ = [
    "DEFAULT",
    "DARK",
    "DEEPSEEK",
    "SOFT",
    "THEMES",
    "Theme",
    "get_theme",
    "step_color",
]