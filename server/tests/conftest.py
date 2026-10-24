import os

import pytest


@pytest.fixture(autouse=True)
def _isolate_github_env(monkeypatch):
    """fixes.main loads server/.env into os.environ on import; keep real credentials out of tests."""
    for name in [n for n in os.environ if n.startswith("GITHUB_")]:
        monkeypatch.delenv(name, raising=False)
