"""Repository-root ASGI entry point.

This keeps ``uvicorn main:app`` working when the command is run from the
repository root. The canonical server entry point remains ``server.main``.
"""

from server.main import app

__all__ = ["app"]
