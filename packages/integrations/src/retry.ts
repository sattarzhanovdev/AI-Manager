/** Повторы исходящих событий: 1 мин, 5 мин, 30 мин, 2 ч, 12 ч — затем очередь ошибок и алерт */
export const RETRY_SCHEDULE_S = [60, 300, 1800, 7200, 43200] as const;

export function nextRetry(attempt: number): { delayS: number } | { dead: true } {
  const d = RETRY_SCHEDULE_S[attempt - 1];
  return d == null ? { dead: true } : { delayS: d };
}

/** Временные ошибки повторяем; 4xx (кроме 408/429) — нет: ошибка конфигурации */
export function isRetryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}
