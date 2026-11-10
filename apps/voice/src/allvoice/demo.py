"""Демо-линия (фаза 0): выбор и смена роли голосом, ограничители, отдельный пул."""
from __future__ import annotations

import json
from pathlib import Path

ROLES = {
    "other": ("универсальная", "Демонстрационная компания", "Ассистент"),
    "autoservice": ("автосервис", "Автосервис «Мотор»", "Айгуль"),
    "clinic": ("клиника", "Медцентр «Ала-Тоо»", "Алина"),
    "salon": ("салон", "Салон «Лаванда»", "Диана"),
    "dental": ("стоматология", "Стоматология «Улыбка»", "Мира"),
    "polyclinic": ("поликлиника", "Городская поликлиника № 7", "Нурия"),
}

DEMO_GREETING = (
    "Здравствуйте! Это демо-линия ALL-менеджера. Я виртуальный ассистент. "
    "Кем мне быть: автосервис, клиника, салон, стоматология или поликлиника?"
)

ROOT = Path(__file__).resolve().parents[4]


def role_snapshot(role: str) -> dict:
    """Shared isolated role snapshots generated from packages/dialog/src/demo-roles.ts."""
    snapshots = json.loads((ROOT / 'packages/dialog/generated/demo-roles.json').read_text(encoding='utf-8'))
    return snapshots.get(role, snapshots['other'])


def detect_role(text: str) -> str | None:
    import re
    t = text.lower().strip()
    roles = ['autoservice', 'clinic', 'salon', 'dental', 'polyclinic', 'other']
    if t in ['1', '2', '3', '4', '5', '6']:
        return roles[int(t)-1]
    for role, pattern in [('polyclinic', r'поликлиник|цсм|участков'), ('dental', r'стомат|зуб|дент'), ('salon', r'салон|красот|парикмах'), ('autoservice', r'автосервис|шиномонтаж|мотор'), ('clinic', r'клиник|медцентр|терапевт'), ('other', r'универсальн|другой бизнес')]:
        if re.search(pattern, t):
            return role
    return None
