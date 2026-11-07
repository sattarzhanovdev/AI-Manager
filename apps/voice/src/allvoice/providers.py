"""Провайдеры за интерфейсами SpeechToText / LanguageModel / TextToSpeech; резерв на каждый слой, переключение ≤ 1 с.

Используются FallbackAdapter из LiveKit Agents: при ошибке или таймауте основного провайдера
запрос уходит в резервный; события переключения пишутся в метрики.
"""
from __future__ import annotations

from livekit.agents import llm, stt, tts
from livekit.plugins import cartesia, deepgram, openai

from .config import Settings


def _llm(spec: str) -> llm.LLM:
    vendor, _, model = spec.partition(":")
    if vendor == "openai":
        return openai.LLM(model=model or "gpt-4.1-mini", temperature=0.3)
    raise ValueError(f"unknown LLM provider {spec}")


def _stt(name: str) -> stt.STT:
    if name == "deepgram":
        return deepgram.STT(model="nova-3", language="ru", interim_results=True, smart_format=True)
    if name == "openai":
        return openai.STT(model="gpt-4o-transcribe", language="ru")
    raise ValueError(f"unknown STT provider {name}")


def _tts(name: str) -> tts.TTS:
    if name == "cartesia":
        return cartesia.TTS(model="sonic-2", language="ru")
    if name == "openai":
        return openai.TTS(model="gpt-4o-mini-tts", voice="nova")
    raise ValueError(f"unknown TTS provider {name}")


def build_stack(cfg: Settings):
    """STT/LLM/TTS с резервом. attempt_timeout ≈ 1 с — укладываемся в бюджет реплики."""
    return (
        stt.FallbackAdapter([_stt(cfg.stt_primary), _stt(cfg.stt_fallback)]),
        llm.FallbackAdapter([_llm(cfg.llm_primary), _llm(cfg.llm_fallback)], attempt_timeout=cfg.llm_first_token_timeout_s, max_retry_per_llm=0),
        tts.FallbackAdapter([_tts(cfg.tts_primary), _tts(cfg.tts_fallback)]),
    )
