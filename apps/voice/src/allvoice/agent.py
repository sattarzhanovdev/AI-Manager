"""Голосовой агент ALL-менеджера на LiveKit Agents.

Конвейер: Silero VAD → потоковый STT → детектор конца фразы по смыслу → LLM с функциями →
охрана ответа по предложениям → потоковый TTS. Перебивание останавливает речь (LiveKit обрезает историю
до сказанного). Голос не ходит в БД на каждой реплике: снимок анкеты в памяти, события — в очередь.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterable

from livekit import api
from livekit.agents import Agent, AgentSession, JobContext, ModelSettings, RunContext, WorkerOptions, cli, function_tool
from livekit.agents.metrics import EOUMetrics, LLMMetrics, STTMetrics, TTSMetrics
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from . import demo
from .config import Settings
from .events import EventBus
from .guard import SentenceGuard, guard_tool
from .metrics import CallMetrics
from .prompt import allowed_tools, build_prompt
from .providers import build_stack
from .kb import find_service, search_kb
from .snapshot import SnapshotStore

log = logging.getLogger("allvoice")
cfg = Settings()  # type: ignore[call-arg]


class Assistant(Agent):
    def __init__(self, *, snapshot: dict, mode: str, call: dict, bus: EventBus, metrics: CallMetrics):
        self.snapshot = snapshot
        self.mode = mode
        self.call = call
        self.bus = bus
        self.metrics = metrics
        self.allowed = allowed_tools(mode)
        self.lead_created = False
        super().__init__(instructions=build_prompt(snapshot, channel="voice", mode=mode))

    # ── Охрана ответа: каждое предложение проверяется до синтеза ──
    async def tts_node(self, text: AsyncIterable[str], model_settings: ModelSettings):
        guard = SentenceGuard(self.snapshot)

        async def guarded() -> AsyncIterable[str]:
            async for chunk in text:
                for sentence in guard.feed(chunk):
                    yield sentence
            for sentence in guard.flush():
                yield sentence
            if guard.actions:
                log.info("guard actions=%s", guard.actions)

        return Agent.default.tts_node(self, guarded(), model_settings)

    def _check(self, name: str) -> str | None:
        if not guard_tool(name, self.allowed):
            return f"Функция {name} недоступна в этом режиме."
        return None

    @function_tool
    async def search_kb(self, context: RunContext, query: str) -> dict:
        """Найти ответ в анкете компании. Вызывай перед любым ответом о фактах компании."""
        if err := self._check("search_kb"):
            return {"error": err}
        return {"fragments": search_kb(self.snapshot, query)}

    @function_tool
    async def get_service(self, context: RunContext, name: str) -> dict:
        """Цена (тип, от, до, валюта), длительность и исполнители услуги. Цены называй только отсюда."""
        if err := self._check("get_service"):
            return {"error": err}
        sv = find_service(self.snapshot, name)
        if not sv:
            return {"found": False}
        if sv["priceType"] == "after_inspection":
            return {"found": True, "name": sv["name"], "priceType": "after_inspection", "note": "Цену не называй: определяется после осмотра"}
        return {"found": True, **{k: sv.get(k) for k in ("name", "priceType", "priceMin", "priceMax", "currency", "durationMin", "staff")}, "money_unit": "minor"}

    @function_tool
    async def get_hours(self, context: RunContext, branch: str = "", date: str = "") -> dict:
        """График работы филиала на дату с учётом праздников."""
        branches = self.snapshot.get("branches", [])
        b = next((x for x in branches if branch and branch.lower() in x["name"].lower()), branches[0] if branches else None)
        return {"branch": b and b["name"], "address": b and b["address"], "hours": b and b["hours"]}

    @function_tool
    async def create_lead(self, context: RunContext, type: str, phone: str, name: str = "", service: str = "", preferred_time: str = "", comment: str = "", priority: str = "normal") -> dict:
        """Создать заявку, когда клиент хочет записаться, заказать, перезвонить или пожаловаться и обязательные поля собраны."""
        if err := self._check("create_lead"):
            return {"error": err}
        payload = {"source": "call", "source_id": self.call.get("call_id"), "type": type, "priority": priority, "title": service or comment or "Заявка из звонка",
                   "fields": {"phone": phone or self.call.get("caller"), "name": name, "service": service, "preferred_time": preferred_time, "comment": comment}}
        # Идемпотентность: один звонок — одна заявка каждого типа
        lead_id = await self.bus.rpc("create_lead", {"p_company_id": self.call["company_id"], "p_payload": payload, "p_idempotency_key": f"{self.call.get('call_id')}:{type}"})
        self.lead_created = True
        return {"lead_id": lead_id}

    @function_tool
    async def transfer_to_human(self, context: RunContext, reason: str, target: str = "") -> dict:
        """Перевести звонок сотруднику: резюме перед соединением, возврат к AI через 20 с без ответа."""
        if err := self._check("transfer_to_human"):
            return {"error": err}
        phone = next((s.get("transferPhone") for s in self.snapshot.get("staff", []) if s.get("transferPhone") and (not target or target.lower() in s["name"].lower())), None)
        if not phone or not cfg.sip_trunk_id:
            await self.create_lead(context, type="callback", phone=self.call.get("caller", ""), comment=f"Перевод: {reason}", priority="urgent")
            return {"status": "no_target", "say": self.snapshot.get("handoff", {}).get("noAnswer", "")}
        lk = api.LiveKitAPI(cfg.livekit_url, cfg.livekit_api_key, cfg.livekit_api_secret)
        started = time.monotonic()
        try:
            await asyncio.wait_for(lk.sip.create_sip_participant(api.CreateSIPParticipantRequest(
                sip_trunk_id=cfg.sip_trunk_id, sip_call_to=phone, room_name=self.call["room"], participant_identity=f"staff-{phone[-4:]}",
                wait_until_answered=True)), timeout=cfg.transfer_timeout_s)
            self.bus.emit("call_ended", {"company_id": self.call["company_id"], "call_id": self.call.get("call_id"), "transfer": {"reason": reason, "answered": True, "wait_ms": int((time.monotonic() - started) * 1000)}})
            return {"status": "connected"}
        except (asyncio.TimeoutError, api.TwirpError):
            return {"status": "no_answer", "say": "Сейчас все заняты. Я создала срочную заявку, вам перезвонят в течение 15 минут."}
        finally:
            await lk.aclose()

    @function_tool
    async def end_call(self, context: RunContext, outcome: str) -> dict:
        """Завершить звонок после прощания."""
        self.call["outcome"] = outcome
        return {"ok": True}

    @function_tool
    async def switch_demo_role(self, context: RunContext, role: str) -> dict:
        """Сменить роль демо-компании по просьбе звонящего."""
        if err := self._check("switch_demo_role"):
            return {"error": err}
        if role not in demo.ROLES:
            return {"error": "unknown role"}
        self.snapshot = demo.role_snapshot(role)
        await self.update_instructions(build_prompt(self.snapshot, channel="voice", mode="demo"))
        self.call.setdefault("roles", []).append(role)
        return {"role": role, "greeting": self.snapshot["style"]["greeting"]}

    @function_tool
    async def send_demo_summary(self, context: RunContext, consent: bool) -> dict:
        """Отправить SMS со ссылкой на результат демо, только с согласия звонящего."""
        if not consent:
            return {"sent": False}
        self.bus.emit("demo_summary", {"phone": self.call.get("caller"), "call_id": self.call.get("call_id")})
        return {"sent": True}


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    participant = await ctx.wait_for_participant()
    attrs = participant.attributes
    dialed = attrs.get("sip.trunkPhoneNumber", "")
    caller = attrs.get("sip.phoneNumber", "")
    bus = EventBus(cfg)
    store = SnapshotStore(cfg)
    metrics = CallMetrics()

    is_demo = ctx.room.name.startswith("demo-")
    if is_demo:
        check = await bus.rpc("demo_check", {"p_phone": caller})
        if not (isinstance(check, dict) and check.get("allowed")):
            # ограничители демо: 5 звонков с номера в сутки, дневной бюджет
            ctx.shutdown(reason="demo_limit")
            return
        snapshot, mode, company_id, greeting = demo.role_snapshot("autoservice"), "demo", None, demo.DEMO_GREETING
        max_duration = cfg.demo_max_duration_s
    else:
        num = await store.resolve_number(dialed)
        if not num or num.get("ai_mode") in ("off", "all_human"):
            ctx.shutdown(reason="ai_disabled")
            return
        snapshot = await store.get(num["company_id"], num["kb_version"])
        mode = "leads" if num.get("ai_mode") == "leads_only" or not num.get("limits", {}).get("allowed", True) else "consult"
        company_id, greeting = num["company_id"], snapshot["style"]["greeting"]
        max_duration = 600

    call = {"company_id": company_id, "caller": caller, "room": ctx.room.name, "kb_version": snapshot.get("version"), "started": time.time()}
    bus.emit("notify", {"kind": "call.started", "company_id": company_id})  # для «Состояния» на Обзоре

    stt, llm, tts = build_stack(cfg)
    session = AgentSession(
        stt=stt, llm=llm, tts=tts, vad=silero.VAD.load(), turn_detection=MultilingualModel(),
        allow_interruptions=True, min_interruption_duration=0.2,  # перебивание: речь AI останавливается ≤ 200 мс
        preemptive_generation=True,
    )

    @session.on("metrics_collected")
    def _on_metrics(ev) -> None:  # noqa: ANN001
        m = ev.metrics
        cur = metrics.current()
        if isinstance(m, STTMetrics):
            cur.stt_ms = int(m.duration * 1000)
        elif isinstance(m, EOUMetrics):
            cur.eou_ms = int(m.end_of_utterance_delay * 1000)
        elif isinstance(m, LLMMetrics):
            cur.llm_ttft_ms = int(m.ttft * 1000)
        elif isinstance(m, TTSMetrics):
            cur.tts_ttfb_ms = int(m.ttfb * 1000)
            metrics.next_turn()

    # Бэкченнелинг: «угу» при длинной реплике клиента, не чаще раза в 4–6 с
    last_bc = 0.0
    speaking_since: float | None = None

    @session.on("user_state_changed")
    def _on_user_state(ev) -> None:  # noqa: ANN001
        nonlocal speaking_since
        speaking_since = time.monotonic() if ev.new_state == "speaking" else None

    async def backchannel_loop() -> None:
        nonlocal last_bc
        while True:
            await asyncio.sleep(0.5)
            if speaking_since and time.monotonic() - speaking_since > 5 and time.monotonic() - last_bc > cfg.backchannel_min_gap_s:
                last_bc = time.monotonic()
                session.say("угу", add_to_chat_ctx=False, allow_interruptions=True)

    agent = Assistant(snapshot=snapshot, mode=mode, call=call, bus=bus, metrics=metrics)
    await session.start(room=ctx.room, agent=agent)
    # Приветствие — заранее синтезированный файл (kb_published) или синтез сразу; цель ≤ 700 мс
    session.say(greeting, allow_interruptions=True)
    bc = asyncio.create_task(backchannel_loop())

    async def on_end() -> None:
        bc.cancel()
        summary = metrics.summary()
        bus.emit("call_ended", {"company_id": company_id, "call_id": call.get("call_id"), "room": ctx.room.name, "duration_s": int(time.time() - call["started"]),
                                "latency": summary, "kb_version": call["kb_version"], "outcome": call.get("outcome"), "demo": is_demo, "roles": call.get("roles", [])})
        await bus.drain()

    ctx.add_shutdown_callback(on_end)
    await asyncio.sleep(max_duration)
    session.say("Время звонка подошло к концу. Спасибо, что позвонили!", allow_interruptions=False)
    await asyncio.sleep(4)
    ctx.shutdown(reason="max_duration")


def main() -> None:
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="all-manager"))


if __name__ == "__main__":
    main()
