"""Configuration from environment variables (and a local .env), validated at startup.

Every variable is documented in .env.example. Secrets are `SecretStr`, so they never appear in logs,
reprs or error messages; read them with `.get_secret_value()` only where they are used.
"""

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]


class Settings(BaseSettings):
    # Values pasted into a dashboard often carry a stray space (" claude-haiku-5-5"): trim them.
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", str_strip_whitespace=True
    )

    environment: Environment = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_format: Literal["json", "console"] | None = Field(
        default=None, description="Defaults to json in production and console elsewhere"
    )

    owner_email: str = Field(
        default="owner@zankup.local", description="Owner account until sign-up (OS-221) sets the real one"
    )
    sync_interval_minutes: int = Field(
        default=15, ge=0, description="Garmin sync schedule; 0 turns automatic syncs off"
    )
    run_worker: bool = Field(default=True, description="Run the job worker inside the API process")
    dev_login: bool = Field(
        default=False, description="Development only: one-click sign-in as the instance's first user"
    )

    database_url: str = "postgresql://zankup:zankup@127.0.0.1:5432/zankup"
    data_dir: Path = Path("data")

    garmin_personal_api_key: SecretStr | None = None
    garmin_key_expires_on: date | None = Field(
        None, description="When the Personal API key expires (shown in Settings, warned two weeks before)"
    )
    jwt_secret: SecretStr | None = None
    resend_api_key: SecretStr | None = None
    alert_email: str | None = Field(default=None, description="Where sync failure alerts go (OS-114)")
    alert_from: str = Field(
        default="Zankup <onboarding@resend.dev>",
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

    # Passkeys (OS-405): the domain they are bound to, and the origins allowed to use them.
    webauthn_rp_id: str = Field(default="localhost", description="zankup.com in production; never change it")
    webauthn_origins: list[str] = Field(
        default=["http://localhost:5173", "http://localhost:8000"],
        description="Origins of the PWA (and later the Android app's apk-key-hash origin)",
    )

    # Web Push (OS-401): generated on the data volume when not set.
    vapid_private_key: SecretStr | None = Field(
        default=None, description="PEM or base64url P-256 key; without it one is kept in DATA_DIR"
    )
    # Android notifications (OS-507): the Firebase service account's JSON key, as is.
    fcm_service_account: SecretStr | None = Field(
        default=None, description="Firebase service account JSON; without it the app gets no notifications"
    )
    # Large uploads and downloads (imports, exports) go straight to the API host, not through the web
    # proxy, which limits request sizes and bills for the traffic.
    api_public_url: str | None = Field(
        default=None, description="e.g. https://api.zankup.com; unset means the same origin as the app"
    )

    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    # Google Health (OS-603): the same OAuth client, with the Google Health API enabled in its project
    # and <origin>/api/wellness/google/callback as an extra redirect URI.
    google_health_enabled: bool = Field(
        default=False, description="Offer connecting Google Health (Fitbit Air) in Settings"
    )
    google_health_webhook_secret: SecretStr | None = Field(
        default=None, description="The subscriber's secret for /api/webhooks/google-health (OS-604)"
    )
    # AI assistant (phase 7): without a key every AI feature is hidden and the rest works the same.
    anthropic_api_key: SecretStr | None = None
    ai_model: str = Field(
        default="claude-haiku-5-5", description="The model behind summaries, reports and the Coach"
    )
    ai_monthly_budget_usd: float = Field(
        default=5.0, gt=0, description="Spending cap per calendar month; AI features pause when it is reached"
    )
    weekly_report_hour_utc: int = Field(default=6, ge=0, le=23, description="When Monday's report is queued")

    @model_validator(mode="after")
    def _no_dev_login_in_production(self) -> Self:
        if self.is_production and self.dev_login:
            raise ValueError("DEV_LOGIN signs in without a password or code: it cannot be used in production")
        return self

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
    def vapid_subject(self) -> str:
        return f"mailto:{self.alert_email or self.owner_email}"

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
            "google_health": self.google_health_enabled
            and self.google_client_id is not None
            and self.google_client_secret is not None,
            "ai": self.anthropic_api_key is not None,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
