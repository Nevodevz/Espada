import sys
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_SECRET = "CHANGE_ME_IN_PRODUCTION_use_openssl_rand_hex_32"

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    POSTGRES_USER: str = "espada"
    POSTGRES_PASSWORD: str = "espada_pass"
    POSTGRES_DB: str = "espada"
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432

    SECRET_KEY: str = _DEFAULT_SECRET
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    FRONTEND_URL: str = "http://localhost:3000"
    ENVIRONMENT: str = "development"  # "production" triggers security checks

    # ── Media (avatars) ──────────────────────────────────────────
    # Directory must live on a persistent volume; served at MEDIA_URL_PREFIX.
    MEDIA_ROOT: str = "/app/media"
    MEDIA_URL_PREFIX: str = "/media"
    MAX_AVATAR_BYTES: int = 5 * 1024 * 1024  # 5 MB

    # ── WhatsApp (Evolution API v2.3.7, see services/whatsapp) ────
    # Empty EVOLUTION_URL = integration disabled.
    EVOLUTION_URL: str = ""
    EVOLUTION_API_KEY: str = ""
    WHATSAPP_INSTANCE: str = "espada-sales"
    WHATSAPP_WEBHOOK_SECRET: str = ""
    WHATSAPP_WEBHOOK_BASE: str = "http://backend:8000"
    # Client files live OUTSIDE MEDIA_ROOT: nginx serves MEDIA_ROOT publicly.
    WHATSAPP_MEDIA_ROOT: str = "/app/whatsapp_media"
    WHATSAPP_MAX_UPLOAD_BYTES: int = 16 * 1024 * 1024

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    def check_production_security(self):
        """Call on startup in production — fail fast on insecure defaults."""
        if self.ENVIRONMENT == "production":
            if self.SECRET_KEY == _DEFAULT_SECRET:
                print("FATAL: SECRET_KEY is default value. Set a strong SECRET_KEY in .env", file=sys.stderr)
                sys.exit(1)

settings = Settings()
