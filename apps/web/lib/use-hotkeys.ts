"use client";
import { useEffect } from "react";

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]");

/** Одиночная клавиша вне полей ввода */
export function useHotkey(key: string, fn: (e: KeyboardEvent) => void, opts: { meta?: boolean; allowInInput?: boolean } = {}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!opts.allowInInput && isTyping(e.target)) return;
      if (!!opts.meta !== (e.metaKey || e.ctrlKey)) return;
      if (e.altKey) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

export { isTyping };
