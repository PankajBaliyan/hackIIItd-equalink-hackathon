from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    frontend_url: str = "http://localhost:5173"
    database_url: str = "sqlite:///./equalink.db"
    state_secret: str = ""

    server_url: str = "http://localhost:8000"

    # Scans fetch URLs the user supplies. Allow localhost/private targets for local dev; set false when deployed.
    allow_private_targets: bool = True
    max_site_pages: int = 5

    # W3C rules sync: a TinyFish agent fetches the latest W3C accessibility rules into the reference docs.
    tinyfish_api_key: str = ""
    w3c_sync_url: str = "https://www.w3.org/TR/"
    w3c_sync_interval_days: int = 30
    w3c_sync_timeout_seconds: int = 1800
    w3c_sync_schedule: bool = True  # false: only the "Sync now" button runs it

    hybrid_api_token: str = ""  # required bearer token for the customer-side runner
    hybrid_repo: str = ""
    hybrid_file_path: str = ""  # explicit source HTML file, never inferred from an intranet URL
    hybrid_base_branch: str = "main"
    hybrid_timeout_seconds: int = 300

    github_client_id: str = ""
    github_client_secret: str = ""
    github_token: str = ""
    github_app_id: str = ""
    github_app_slug: str = ""
    github_app_private_key: str = ""
    github_app_private_key_path: str = ""
    github_webhook_secret: str = ""

    @property
    def app_private_key(self) -> str:
        """PEM contents from the env var (\\n escapes allowed) or from the key file."""
        if self.github_app_private_key:
            return self.github_app_private_key.replace("\\n", "\n")
        if self.github_app_private_key_path:
            return Path(self.github_app_private_key_path).expanduser().read_text()
        return ""

    @property
    def app_configured(self) -> bool:
        return bool(self.github_app_id and self.github_app_slug and self.app_private_key)

    @property
    def oauth_configured(self) -> bool:
        return bool(self.github_client_id and self.github_client_secret)

    @property
    def oauth_redirect_uri(self) -> str:
        return f"{self.server_url.rstrip('/')}/integrations/github/oauth/callback"

    @property
    def github_mode(self) -> str:
        """'app' (production), 'oauth' ("Sign in with GitHub"), 'pat' (dev token), or 'none'."""
        if self.app_configured:
            return "app"
        if self.oauth_configured:
            return "oauth"
        return "pat" if self.github_token else "none"


@lru_cache
def get_settings() -> Settings:
    return Settings()
