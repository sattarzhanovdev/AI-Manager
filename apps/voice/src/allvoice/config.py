from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Все переменные проверяются при старте (раздел 02)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_service_role_key: str
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    redis_url: str = "redis://localhost:6379"
    stt_primary: str = "deepgram"
    stt_fallback: str = "openai"
    llm_primary: str = "openai:gpt-4.1-mini"
    llm_fallback: str = "openai:gpt-4.1-nano"
    tts_primary: str = "cartesia"
    tts_fallback: str = "openai"
    sip_trunk_id: str = ""
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""

    # Бюджет реплики (раздел 26)
    turn_budget_p50_ms: int = 700
    turn_budget_p95_ms: int = 1200
    llm_first_token_timeout_s: float = 1.0
    transfer_timeout_s: int = 20
    backchannel_min_gap_s: float = 4.0

    # Демо-линия
    demo_max_duration_s: int = 900
    demo_max_calls_per_day: int = 5
