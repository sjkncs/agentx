"""Argparse wiring — every subcommand must register and parse."""

from __future__ import annotations

EXPECTED_COMMANDS = {
    "init",
    "status",
    "doctor",
    "notebook",
    "dashboard",
    "run",
    "upgrade",
}


def test_all_top_level_commands_register(parser) -> None:
    assert EXPECTED_COMMANDS.issubset({c for c in parser._subparsers._group_actions[0].choices})
    # noinspection PyProtectedMember
    actions = parser._subparsers._group_actions[0].choices  # type: ignore[attr-defined]
    assert "init" in actions
    assert "status" in actions
    assert "doctor" in actions
    assert "notebook" in actions
    assert "dashboard" in actions
    assert "run" in actions
    assert "upgrade" in actions


def test_version_flag(parser, capsys) -> None:
    try:
        parser.parse_args(["--version"])
    except SystemExit as exc:
        assert exc.code == 0
    captured = capsys.readouterr()
    assert "df-cli" in captured.out


def test_notebook_subcommands(parser) -> None:
    args = parser.parse_args(["notebook", "list"])
    assert args.command == "notebook"
    assert args.notebook_command == "list"
    args = parser.parse_args(["notebook", "run", "nb-42"])
    assert args.notebook_command == "run"
    assert args.notebook_id == "nb-42"


def test_dashboard_subcommands(parser) -> None:
    args = parser.parse_args(["dashboard", "apply-template", "ops-overview", "--title", "My Ops"])
    assert args.command == "dashboard"
    assert args.dashboard_command == "apply-template"
    assert args.template_id == "ops-overview"
    assert args.title == "My Ops"


def test_run_flag(parser) -> None:
    args = parser.parse_args(["run", "sess-9", "--follow", "--interval", "2.5"])
    assert args.command == "run"
    assert args.session_id == "sess-9"
    assert args.follow is True
    assert args.interval == 2.5


def test_override_flags(parser, tmp_config_path) -> None:
    args = parser.parse_args([
        "--api-base", "http://override", "--config", str(tmp_config_path), "status",
    ])
    assert args.api_base == "http://override"
    assert args.config == str(tmp_config_path)
    assert args.command == "status"