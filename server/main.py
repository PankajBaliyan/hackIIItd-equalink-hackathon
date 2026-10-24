"""Unified FastAPI entry point for GitHub, Sites, and Fixes."""

import sys
from pathlib import Path

SERVER_DIR = str(Path(__file__).resolve().parent)
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from app.main import app  # noqa: E402

__all__ = ["app"]
