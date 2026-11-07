"use client";
import * as React from "react";
import type { Density, FilterValues, SavedView } from "@all/ui";

/**
 * Состояние списка: вид, фильтры, поиск, плотность, открытая запись (?open=), пользовательские виды.
 * Пользовательские виды и плотность хранятся в браузере.
 */
export function useListState(key: string, builtinViews: SavedView[], initial?: { view?: string; filters?: FilterValues; open?: string }) {
  const [view, setView] = React.useState(initial?.view ?? builtinViews[0]?.id ?? "all");
  const [filters, setFilters] = React.useState<FilterValues>(initial?.filters ?? builtinViews.find((v) => v.id === initial?.view)?.filters ?? {});
  const [search, setSearch] = React.useState("");
  const [density, setDensityState] = React.useState<Density>("default");
  const [openId, setOpenIdState] = React.useState<string | undefined>(initial?.open);
  const [custom, setCustom] = React.useState<SavedView[]>([]);

  React.useEffect(() => {
    try {
      const d = localStorage.getItem(`${key}:density`) as Density | null;
      if (d) setDensityState(d);
      const c = localStorage.getItem(`${key}:views`);
      if (c) setCustom(JSON.parse(c) as SavedView[]);
    } catch { /* приватный режим */ }
  }, [key]);

  const setDensity = (d: Density) => { setDensityState(d); try { localStorage.setItem(`${key}:density`, d); } catch { /* ignore */ } };
  const setOpenId = React.useCallback((id?: string) => {
    setOpenIdState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("open", id); else url.searchParams.delete("open");
    window.history.replaceState(null, "", url);
  }, []);
  const applyView = (v: SavedView) => { setView(v.id); setFilters(v.filters); };
  const changeFilters = (f: FilterValues) => { setFilters(f); setView("custom"); };
  const saveView = (label: string) => {
    const v: SavedView = { id: `u_${Date.now()}`, label, filters };
    const next = [...custom, v];
    setCustom(next);
    setView(v.id);
    try { localStorage.setItem(`${key}:views`, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return { view, filters, search, setSearch, density, setDensity, openId, setOpenId, applyView, changeFilters, views: [...builtinViews, ...custom], saveView };
}

export function matchSearch(q: string, ...fields: (string | undefined | null)[]) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, "");
  return fields.some((f) => f && (f.toLowerCase().includes(s) || (digits.length >= 3 && f.replace(/\D/g, "").includes(digits))));
}
