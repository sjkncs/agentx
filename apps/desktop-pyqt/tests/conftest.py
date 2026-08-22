"""Pytest config for `df-desktop` tests."""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running tests without installing the package: add `src` to sys.path.
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))