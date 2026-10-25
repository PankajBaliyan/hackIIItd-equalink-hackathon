from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    frontend_url: str = "http://localhost:5173"
    database_url: str = "sqlite:///./equalink.db"
    state_secret: str = ""

    server_url: str = "http://localhost:8000"

    # Scans fetch URLs the user supplies. Allow localhost/private targets for local dev; set false when deployed.
    allow_private_targets: bool = True
    max_site_pages: int = 20
    # What a scan form starts with. Editable in the dashboard (Settings), which overrides these.
    default_level: Literal["A", "AA", "AAA"] = "AA"
    default_scope: Literal["page", "site"] = "page"
    # Only issues at or above this severity are recorded, and rules listed here (comma separated) are skipped.
    min_severity: Literal["minor", "moderate", "serious", "critical"] = "minor"
    disabled_rules: str = ""
    # Switches for the two OpenAI stages, which need OPENAI_API_KEY and cost money per scan.
    ai_review: bool = True
    ai_fixes: bool = True
    # Page screenshots are capped to this many CSS pixels of height (very long pages are cut off at the bottom).
    screenshot_max_height: int = 4000

    # Where scans render pages: "auto" uses a TinyFish remote browser for public URLs when TINYFISH_API_KEY is set
    # and local Chromium otherwise (TinyFish can't reach localhost); "tinyfish" and "local" force one.
    scan_engine: Literal["auto", "tinyfish", "local"] = "auto"

    # Repo (source code) scans. The static checks always run; the model review pass needs OPENAI_API_KEY.
    source_max_files: int = 150
    source_max_file_bytes: int = 150_000
    source_llm_max_files: int = 40
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1"
    # Fix stage: how many issues get a proposed fix per scan (worst first) and how many go to the model per request.
    fix_max: int = 30
    fix_batch: int = 8

    # W3C rules sync: a TinyFish agent fetches the latest W3C accessibility rules into the reference docs.
    tinyfish_api_key: str = ""
    w3c_sync_url: str = "https://www.w3.org/TR/"
    w3c_sync_interval_days: int = 30
    w3c_sync_timeout_seconds: int = 1800
    w3c_sync_schedule: bool = True  # false: only the "Sync now" button runs it

    github_client_id: str = ""
    github_client_secret: str = ""

    @property
    def oauth_configured(self) -> bool:
        return bool(self.github_client_id and self.github_client_secret)

    @property
    def oauth_redirect_uri(self) -> str:
        return f"{self.server_url.rstrip('/')}/integrations/github/oauth/callback"

    @property
    def github_mode(self) -> str:
        """'oauth' ("Sign in with GitHub") or 'none'."""
        return "oauth" if self.oauth_configured else "none"


@lru_cache
def get_settings() -> Settings:
    return Settings()
