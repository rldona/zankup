"""Configuration from environment variables (and a local .env), validated at startup.

Every variable is documented in .env.example. Secrets are `SecretStr`, so they never appear in logs,
reprs or error messages; read them with `.get_secret_value()` only where they are used.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Environment = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_format: Literal["json", "console"] | None = Field(
        default=None, description="Defaults to json in production and console elsewhere"
    )

    owner_email: str = Field(
        default="owner@opensport.local", description="Owner account until sign-up (OS-221) sets the real one"
    )
    sync_interval_minutes: int = Field(
        default=15, ge=0, description="Garmin sync schedule; 0 turns automatic syncs off"
    )
    run_worker: bool = Field(default=True, description="Run the job worker inside the API process")

    database_url: str = "postgresql://opensport:opensport@127.0.0.1:5432/opensport"
    data_dir: Path = Path("data")

    garmin_personal_api_key: SecretStr | None = None
    jwt_secret: SecretStr | None = None
    resend_api_key: SecretStr | None = None
    alert_email: str | None = Field(default=None, description="Where sync failure alerts go (OS-114)")
    alert_from: str = Field(
        default="OpenSport <onboarding@resend.dev>",
        description="Sender; Resend's test sender only delivers to the Resend account's own address",
    )
    # Daily backups (OS-114): an S3-compatible bucket, or a local directory (another disk).
    backup_s3_endpoint: str | None = None
    backup_s3_bucket: str | None = None
    backup_s3_region: str = "auto"
    backup_s3_access_key_id: str | None = None
    backup_s3_secret_access_key: SecretStr | None = None
    backup_dir: Path | None = None
    backup_keep_days: int = Field(
        default=30, ge=1, description="Database dumps kept; FIT files are kept forever"
    )
    backup_hour_utc: int = Field(default=3, ge=0, le=23, description="When the daily backup runs")
    pg_dump_command: str = "pg_dump"
    pg_restore_command: str = "pg_restore"

    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def effective_log_format(self) -> Literal["json", "console"]:
        return self.log_format or ("json" if self.is_production else "console")

    @property
    def sqlalchemy_url(self) -> str:
        """DATABASE_URL with the psycopg 3 driver (Railway and compose give a plain postgresql:// URL)."""
        url = self.database_url
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url

    @property
    def raw_dir(self) -> Path:
        """Immutable store of the original FIT files (OS-104)."""
        return self.data_dir / "raw"

    def integrations(self) -> dict[str, bool]:
        """Which optional integrations are configured (features stay hidden without them)."""
        return {
            "garmin": self.garmin_personal_api_key is not None,
            "email": self.resend_api_key is not None,
            "backups": self.backup_s3_bucket is not None or self.backup_dir is not None,
            "google_sign_in": self.google_client_id is not None and self.google_client_secret is not None,
            "ai": self.anthropic_api_key is not None,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
