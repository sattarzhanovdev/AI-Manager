"""Охрана ответа: каждое предложение проверяется до синтеза (раздел 27).

Правила совпадают с packages/dialog/src/guard.ts — единые для голоса и чатов.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

PRICE_FALLBACK = "Точную цену уточнит администратор."
HUMAN_CLAIM = re.compile(r"(я\s+(живой\s+)?человек|я\s+не\s+(робот|бот|ии|искусственн)|я\s+настоящ(ий|ая)\s+(человек|сотрудник))", re.I)
CURRENCY = re.compile(r"(сом|сомов|сома|тенге|тг|руб|рублей|рубля|₽|\$|долл)", re.I)
AMOUNT = re.compile(r"(\d[\d\s ]*(?:[.,]\d+)?)\s*(тыс(?:яч[аи]?)?\.?)?", re.I)
SENTENCE = re.compile(r"[^.!?…]+[.!?…]*\s*")


@dataclass
class GuardResult:
    text: str
    actions: list[str] = field(default_factory=list)


def known_amounts(snapshot: dict) -> set[float]:
    out: set[float] = set()
    for s in snapshot.get("services", []):
        if s.get("priceType") == "after_inspection":
            continue
        for k in ("priceMin", "priceMax"):
            if s.get(k) is not None:
                out.add(s[k] / 100)
    return out


def amounts_in(sentence: str) -> list[float]:
    if not CURRENCY.search(sentence):
        return []
    out: list[float] = []
    for m in AMOUNT.finditer(sentence):
        raw = re.sub(r"[\s ]", "", m.group(1)).replace(",", ".")
        try:
            n = float(raw)
        except ValueError:
            continue
        if m.group(2):
            n *= 1000
        if n > 0:
            out.append(n)
    if re.search(r"полторы\s+тысячи", sentence, re.I):
        out.append(1500)
    return out


def guard_sentence(sentence: str, snapshot: dict) -> GuardResult:
    actions: list[str] = []
    text = sentence
    company = snapshot.get("company", {}).get("name", "")
    if HUMAN_CLAIM.search(text):
        actions.append("human_claim")
        text = f"Я виртуальный помощник компании «{company}». "
    amounts = amounts_in(text)
    if amounts and any(a not in known_amounts(snapshot) for a in amounts):
        actions.append("price_replaced")
        text = PRICE_FALLBACK + " "
    stop = snapshot.get("stop", {})
    low = text.lower()
    if any(t and t.lower() in low for t in stop.get("topics", [])):
        actions.append("stop_topic")
        text = stop.get("reply", PRICE_FALLBACK) + " "
    return GuardResult(text, actions)


def split_sentences(text: str) -> list[str]:
    return SENTENCE.findall(text) or [text]


def guard_tool(name: str, allowed: list[str]) -> bool:
    """Вызов неразрешённой функции отклоняется."""
    return name in allowed


class SentenceGuard:
    """Потоковая охрана: копит токены LLM до конца предложения, проверяет, отдаёт в TTS."""

    def __init__(self, snapshot: dict):
        self.snapshot = snapshot
        self.buf = ""
        self.actions: list[str] = []

    def feed(self, chunk: str) -> list[str]:
        self.buf += chunk
        out: list[str] = []
        while True:
            m = re.search(r"[.!?…]+\s", self.buf)
            if not m:
                break
            sentence, self.buf = self.buf[: m.end()], self.buf[m.end():]
            r = guard_sentence(sentence, self.snapshot)
            self.actions += r.actions
            out.append(r.text)
        return out

    def flush(self) -> list[str]:
        if not self.buf.strip():
            return []
        r = guard_sentence(self.buf, self.snapshot)
        self.buf = ""
        self.actions += r.actions
        return [r.text]
