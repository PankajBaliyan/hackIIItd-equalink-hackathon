from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    frontend_url: str = "http://localhost:5173"
    database_url: str = "sqlite:///./equalink.db"
    state_secret: str = ""

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
    def github_mode(self) -> str:
        """'app' (preferred), 'pat', or 'none'."""
        if self.app_configured:
            return "app"
        return "pat" if self.github_token else "none"


@lru_cache
def get_settings() -> Settings:
    return Settings()
