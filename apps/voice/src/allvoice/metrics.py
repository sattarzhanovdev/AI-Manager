"""Задержки шагов каждой реплики → call_metrics и Langfuse. Без персональных данных."""
from __future__ import annotations

import logging
import statistics
from dataclasses import dataclass, field

log = logging.getLogger("allvoice.metrics")


@dataclass
class TurnMetrics:
    seq: int
    stt_ms: int | None = None
    eou_ms: int | None = None
    llm_ttft_ms: int | None = None
    tts_ttfb_ms: int | None = None

    @property
    def total_ms(self) -> int:
        return sum(x or 0 for x in (self.eou_ms, self.llm_ttft_ms, self.tts_ttfb_ms))


@dataclass
class CallMetrics:
    turns: list[TurnMetrics] = field(default_factory=list)
    fallbacks: int = 0

    def current(self) -> TurnMetrics:
        if not self.turns:
            self.turns.append(TurnMetrics(seq=0))
        return self.turns[-1]

    def next_turn(self) -> TurnMetrics:
        self.turns.append(TurnMetrics(seq=len(self.turns)))
        return self.turns[-1]

    def summary(self) -> dict:
        totals = [t.total_ms for t in self.turns if t.total_ms]
        if not totals:
            return {"p50": 0, "p95": 0, "turns": 0, "fallbacks": self.fallbacks}
        totals.sort()
        return {"p50": int(statistics.median(totals)), "p95": totals[min(len(totals) - 1, int(len(totals) * 0.95))], "turns": len(totals), "fallbacks": self.fallbacks}
