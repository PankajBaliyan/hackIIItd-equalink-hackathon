import os

import pytest

from app.config import Settings


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch):
    """fixes.main loads server/.env into os.environ on import. Keep real credentials and local settings out of the
    tests: otherwise a developer's real OPENAI_API_KEY / TINYFISH_API_KEY would be picked up by Settings(_env_file=None)
    and "no key configured" cases would behave differently (and could spend real money)."""
    for name in [n for n in os.environ if n.startswith("GITHUB_")]:
        monkeypatch.delenv(name, raising=False)
    for field in Settings.model_fields:
        monkeypatch.delenv(field.upper(), raising=False)
