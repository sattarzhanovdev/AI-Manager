"use client";
import { useEffect, useRef } from "react";
import type { RealtimeEvent } from "./data/types";

type Handler = (e: RealtimeEvent) => void;
const handlers = new Set<Handler>();
let source: EventSource | null = null;

function connect() {
  if (source || typeof window === "undefined") return;
  // Realtime из памяти процесса работает только в mock-режиме (см. <html data-rt>)
  if (document.documentElement.dataset.rt === "off") return;
  source = new EventSource("/api/realtime");
  source.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data) as RealtimeEvent;
      for (const h of handlers) h(e);
    } catch { /* пропускаем битые события */ }
  };
  source.onerror = () => {
    source?.close();
    source = null;
    setTimeout(() => { if (handlers.size) connect(); }, 3000);
  };
}

/** Подписка на события Realtime (одно соединение на вкладку) */
export function useRealtime(handler: Handler) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    const h: Handler = (e) => ref.current(e);
    handlers.add(h);
    connect();
    return () => {
      handlers.delete(h);
      if (!handlers.size) { source?.close(); source = null; }
    };
  }, []);
}
