"""Pydantic schemas mirroring the AgentX `/api/v1/*` DTOs."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    """Base config: tolerate unknown keys, no aliasing."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


# ----------------------------------------------------------------------
# Identity / workspace
# ----------------------------------------------------------------------
class AuthUserDto(_Base):
    id: str
    email: str | None = None
    display_name: str | None = Field(default=None, alias="displayName")


class WorkspaceDto(_Base):
    id: str
    name: str | None = None


class MeResponse(_Base):
    user: AuthUserDto
    workspace: WorkspaceDto
    role: Literal["owner", "admin", "member", "viewer"] | None = None


# ----------------------------------------------------------------------
# Sessions
# ----------------------------------------------------------------------
class Session(_Base):
    id: str
    title: str | None = None
    user_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    last_active_at: str | None = None
    title_source: str | None = None
    selected_datasource_id: str | None = None
    selected_collection_id: str | None = None


class SessionList(_Base):
    sessions: list[Session] = Field(default_factory=list)
    next_cursor: str | None = None


# ----------------------------------------------------------------------
# Trace DAG (matches `TraceDagDto` in the web client)
# ----------------------------------------------------------------------
class TraceDagNode(_Base):
    id: str
    kind: Literal[
        "artifact", "branch", "context", "run-start", "run-terminal", "tool", "user-turn",
    ]
    summary: str
    status: str
    detail: dict[str, Any] = Field(default_factory=dict)


class TraceDagEdge(_Base):
    from_: str = Field(alias="from")
    to: str
    kind: str


class TraceDagSection(_Base):
    id: str
    label: str
    node_ids: list[str] = Field(default_factory=list, alias="nodeIds")


class TraceDag(_Base):
    session_id: str | None = None
    nodes: list[TraceDagNode] = Field(default_factory=list)
    edges: list[TraceDagEdge] = Field(default_factory=list)
    sections: list[TraceDagSection] = Field(default_factory=list)


# ----------------------------------------------------------------------
# DataLink graph
# ----------------------------------------------------------------------
class DatalinkGraphNode(_Base):
    id: str
    label: str
    kind: Literal["table", "column", "concept", "entity"]
    metadata: dict[str, Any] = Field(default_factory=dict)


class DatalinkGraphEdge(_Base):
    from_: str = Field(alias="from")
    to: str
    kind: str
    weight: float = 1.0


class DatalinkGraph(_Base):
    server_id: str | None = None
    nodes: list[DatalinkGraphNode] = Field(default_factory=list)
    edges: list[DatalinkGraphEdge] = Field(default_factory=list)


__all__ = [
    "AuthUserDto",
    "WorkspaceDto",
    "MeResponse",
    "Session",
    "SessionList",
    "TraceDag",
    "TraceDagNode",
    "TraceDagEdge",
    "TraceDagSection",
    "DatalinkGraph",
    "DatalinkGraphNode",
    "DatalinkGraphEdge",
]