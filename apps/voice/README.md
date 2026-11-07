# apps/voice — голосовой сервис

LiveKit Agents (Python 3.12): Silero VAD → потоковый STT → детектор конца фразы → LLM с функциями → охрана по предложениям → потоковый TTS.

```bash
cd apps/voice
python3.12 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
python -m allvoice.agent download-files   # модели VAD и детектора конца фразы
python -m allvoice.agent dev              # подключается к LIVEKIT_URL
pytest                                    # охрана ответа, поиск, промпт
```

- Промпт и JSON-схемы функций берутся из `packages/dialog` (`pnpm --filter @all/dialog gen:tools`).
- Номер → компания: `resolve_number` (Redis, TTL 10 с — переключатель AI применяется ≤ 10 с).
- Снимок анкеты — Redis/`get_snapshot`, дальше поиск в памяти; события — в pgmq через RPC, не блокируя диалог.
- Резерв на каждый слой (FallbackAdapter), нет первого токена LLM за 1 с → резервный LLM.
- Демо: комнаты `demo-*`, `demo_check` (5 звонков с номера в сутки, дневной бюджет), 15 минут максимум, смена роли голосом.
