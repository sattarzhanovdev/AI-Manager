"""Демо-линия (фаза 0): выбор и смена роли голосом, ограничители, отдельный пул."""
from __future__ import annotations

import json
from pathlib import Path

ROLES = {
    "autoservice": ("автосервис", "Автосервис «Мотор»", "Айгуль"),
    "clinic": ("клиника", "Клиника «Здоровье»", "Алина"),
    "salon": ("салон", "Салон «Лайм»", "Диана"),
    "dental": ("стоматология", "Стоматология «Смайл»", "Мира"),
    "polyclinic": ("поликлиника", "ЦСМ №7", "Нурия"),
}

DEMO_GREETING = (
    "Здравствуйте! Это демо-линия ALL-менеджера. Я виртуальный ассистент. "
    "Кем мне быть: автосервис, клиника, салон, стоматология или поликлиника?"
)

ROOT = Path(__file__).resolve().parents[4]


def role_snapshot(role: str) -> dict:
    """Снимок демо-роли. Автосервис — из packages/dialog/generated/demo-snapshot.json; остальные — из demo_roles."""
    base = json.loads((ROOT / "packages/dialog/generated/demo-snapshot.json").read_text(encoding="utf-8"))
    if role == "autoservice":
        return base
    _, name, assistant = ROLES[role]
    base = {**base, "company": {**base["company"], "name": name, "sphere": role}, "style": {**base["style"], "assistantName": assistant, "greeting": f"{name}, я {assistant}, виртуальный помощник. Чем помочь?"}}
    return base


def detect_role(text: str) -> str | None:
    t = text.lower()
    for key, (word, *_ ) in ROLES.items():
        if word[:5] in t:
            return key
    return None
