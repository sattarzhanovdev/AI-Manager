"""События звонка в очередь (pgmq через Supabase RPC) — не блокируя диалог."""
from __future__ import annotations

import asyncio
import logging

import httpx

from .config import Settings

log = logging.getLogger("allvoice.events")


class EventBus:
    def __init__(self, cfg: Settings):
        self.http = httpx.AsyncClient(base_url=f"{cfg.supabase_url}/rest/v1", headers={
            "apikey": cfg.supabase_service_role_key, "Authorization": f"Bearer {cfg.supabase_service_role_key}",
            "Content-Profile": "pgmq_public"}, timeout=3.0)
        self.tasks: set[asyncio.Task] = set()

    def emit(self, queue: str, message: dict) -> None:
        """Огонь-и-забыть: ошибки логируются без персональных данных."""
        t = asyncio.create_task(self._send(queue, message))
        self.tasks.add(t)
        t.add_done_callback(self.tasks.discard)

    async def _send(self, queue: str, message: dict) -> None:
        try:
            r = await self.http.post("/rpc/send", json={"queue_name": queue, "message": message})
            r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.warning("event send failed queue=%s err=%s", queue, type(e).__name__)

    async def rpc(self, fn: str, args: dict) -> object:
        r = await self.http.post(f"/rpc/{fn}", json=args, headers={"Content-Profile": "public"})
        r.raise_for_status()
        return r.json()

    async def drain(self) -> None:
        if self.tasks:
            await asyncio.wait(self.tasks, timeout=5)
