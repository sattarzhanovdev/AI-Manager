"""Поиск по снимку в памяти — чистые функции без сети (их же покрывают тесты)."""
from __future__ import annotations

import re

STOP = {"а", "и", "в", "на", "у", "вы", "вас", "мне", "я", "ли", "это", "по", "с", "к", "о", "как", "что", "есть", "можно"}


def tokens(s: str) -> list[str]:
    words = re.sub(r"[^\w\s]", " ", s.lower().replace("ё", "е")).split()
    return [w[:-2] if len(w) > 5 else w for w in words if len(w) > 1 and w not in STOP]


def overlap(q: list[str], d: list[str]) -> float:
    if not q or not d:
        return 0.0
    ds = set(d)
    hit = sum(1 if t in ds else (0.5 if len(t) >= 4 and any(x.startswith(t[:4]) for x in d) else 0) for t in q)
    return hit / len(q)


def search_kb(s: dict, query: str, limit: int = 3) -> list[dict]:
    """Локальный поиск по снимку — до 3 фрагментов с источником и оценкой."""
    q = tokens(query)
    hits = []
    for f in s.get("faq", []):
        score = max([overlap(q, tokens(f["question"]))] + [overlap(q, tokens(x)) for x in f.get("synonyms", [])])
        hits.append({"text": f["shortAnswer"], "source": f"FAQ: {f['question']}", "score": round(score, 2)})
    for k, v in s.get("booking", {}).items():
        if v:
            hits.append({"text": v, "source": f"Запись: {k}", "score": round(overlap(q, tokens(v)) * 0.8, 2)})
    return sorted([h for h in hits if h["score"] >= 0.34], key=lambda h: -h["score"])[:limit]


def find_service(s: dict, name: str) -> dict | None:
    q = tokens(name)
    best, best_score = None, 0.6
    for sv in s.get("services", []):
        score = max([overlap(tokens(sv["name"]), q)] + [overlap(tokens(x), q) for x in sv.get("synonyms", [])])
        if score > best_score:
            best, best_score = sv, score
    return best
