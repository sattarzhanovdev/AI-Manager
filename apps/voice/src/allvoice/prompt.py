"""Сборка системного промпта из снимка анкеты (шаблон — packages/dialog/prompts/assistant.ru.md)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TEMPLATE = (ROOT / "packages/dialog/prompts/assistant.ru.md").read_text(encoding="utf-8")
TOOLS = json.loads((ROOT / "packages/dialog/generated/tools.json").read_text(encoding="utf-8"))

SPHERE = {"autoservice": "автосервис", "salon": "салон красоты", "clinic": "клиника", "dental": "стоматология", "service": "сервисная компания", "polyclinic": "поликлиника"}
MODE_TOOLS = {
    "leads": ["search_kb", "get_hours", "create_lead", "transfer_to_human", "end_call"],
    "consult": ["search_kb", "get_service", "get_hours", "create_lead", "transfer_to_human", "end_call"],
    "demo": ["search_kb", "get_service", "get_hours", "create_lead", "end_call", "switch_demo_role", "send_demo_summary"],
}


def allowed_tools(mode: str) -> list[str]:
    return MODE_TOOLS.get(mode, MODE_TOOLS["leads"])


def build_prompt(s: dict, *, channel: str = "voice", mode: str = "consult") -> str:
    style, stop, handoff = s.get("style", {}), s.get("stop", {}), s.get("handoff", {})
    objections = "\n".join(f"- {k}: {v}" for k, v in s.get("objections", {}).items()) or "- нет"
    values = {
        "assistant.name": style.get("assistantName", "Ассистент"),
        "company.name": s["company"]["name"],
        "company.sphere": SPHERE.get(s["company"].get("sphere", ""), "компания"),
        "channel": "по телефону" if channel == "voice" else "в чате",
        "style.address": style.get("address", "Обращайся на «вы»"),
        "style.tone": style.get("tone", "дружелюбный"),
        "languages": ", ".join(style.get("languages", ["ru"])),
        "style.words": ", ".join(style.get("words", [])) or "—",
        "required_fields": ", ".join(s.get("client", {}).get("required", [])) or "имя и телефон",
        "ai_mode": mode,
        "allowed_tools": ", ".join(allowed_tools(mode)),
        "handoff.extra": handoff.get("when") or "—",
        "emergency_number": s.get("emergencyNumber", "103"),
        "stop_topics": "; ".join(stop.get("topics", [])) or "—",
        "stop_reply": stop.get("reply", ""),
        "never_promise": "; ".join(stop.get("neverPromise", [])) or "—",
        "objections": objections,
    }
    return re.sub(r"\{\{([\w.]+)\}\}", lambda m: values.get(m.group(1), ""), TEMPLATE)
