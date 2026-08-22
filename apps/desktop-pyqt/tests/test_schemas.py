"""Schema validation tests — no network required."""

from __future__ import annotations

from df_desktop.api.schemas import (
    DatalinkGraph,
    DatalinkGraphEdge,
    DatalinkGraphNode,
    MeResponse,
    Session,
    TraceDag,
    TraceDagNode,
)


def test_me_response_roundtrip() -> None:
    payload = {
        "user": {"id": "u1", "email": "test@example.com", "displayName": "Test"},
        "workspace": {"id": "personal-u1", "name": "Personal"},
        "role": "owner",
    }
    me = MeResponse.model_validate(payload)
    assert me.user.email == "test@example.com"
    assert me.user.display_name == "Test"
    assert me.role == "owner"


def test_session_minimum() -> None:
    session = Session.model_validate({"id": "abc", "title": "Hello"})
    assert session.id == "abc"
    assert session.title == "Hello"


def test_trace_dag_aliases() -> None:
    payload = {
        "session_id": "sess-1",
        "nodes": [
            {
                "id": "n1",
                "kind": "tool",
                "summary": "Inspect table",
                "status": "ok",
                "detail": {"row_count": 42},
            }
        ],
        "edges": [{"from": "n1", "to": "n1", "kind": "self"}],
        "sections": [{"id": "sec", "label": "Main", "nodeIds": ["n1"]}],
    }
    dag = TraceDag.model_validate(payload)
    assert dag.nodes[0].kind == "tool"
    assert dag.edges[0].from_ == "n1"
    assert dag.sections[0].node_ids == ["n1"]


def test_datalink_graph_roundtrip() -> None:
    payload = {
        "server_id": "server-1",
        "nodes": [
            {"id": "t1", "label": "users", "kind": "table"},
            {"id": "c1", "label": "users.id", "kind": "column"},
        ],
        "edges": [{"from": "t1", "to": "c1", "kind": "HAS_CONCEPT", "weight": 0.9}],
    }
    graph = DatalinkGraph.model_validate(payload)
    assert isinstance(graph.nodes[0], DatalinkGraphNode)
    assert isinstance(graph.edges[0], DatalinkGraphEdge)
    assert graph.edges[0].weight == 0.9


if __name__ == "__main__":
    test_me_response_roundtrip()
    test_session_minimum()
    test_trace_dag_roundtrip = test_trace_dag_aliases
    test_trace_dag_roundtrip()
    test_datalink_graph_roundtrip()
    print("ok")