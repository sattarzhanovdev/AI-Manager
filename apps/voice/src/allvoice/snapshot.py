"""Снимок анкеты: в начале звонка — из Redis, при промахе — get_snapshot. Дальше всё в памяти (без БД на реплике)."""
from __future__ import annotations

import json

import httpx
import redis.asyncio as redis

from .config import Settings


class SnapshotStore:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.redis = redis.from_url(cfg.redis_url)
        self.http = httpx.AsyncClient(base_url=f"{cfg.supabase_url}/rest/v1", headers={
            "apikey": cfg.supabase_service_role_key, "Authorization": f"Bearer {cfg.supabase_service_role_key}"}, timeout=2.0)

    async def rpc(self, fn: str, args: dict) -> object:
        r = await self.http.post(f"/rpc/{fn}", json=args)
        r.raise_for_status()
        return r.json()

    async def resolve_number(self, e164: str) -> dict | None:
        key = f"num:{e164}"
        if cached := await self.redis.get(key):
            return json.loads(cached)
        data = await self.rpc("resolve_number", {"p_e164": e164})
        if data:
            await self.redis.set(key, json.dumps(data), ex=10)  # переключатель AI применяется ≤ 10 с
        return data  # type: ignore[return-value]

    async def get(self, company_id: str, version: int) -> dict:
        key = f"kb:{company_id}:{version}"
        if cached := await self.redis.get(key):
            return json.loads(cached)
        data = await self.rpc("get_snapshot", {"p_company_id": company_id, "p_version": version})
        await self.redis.set(key, json.dumps(data), ex=86400)
        return data  # type: ignore[return-value]


from .kb import find_service, search_kb  # noqa: E402,F401  (реэкспорт)
