"use client";
import * as React from "react";

export function MinutesCalculator({ plans }: { plans: { name: string; minutes: number }[] }) {
  const [calls, setCalls] = React.useState(40);
  const [avg, setAvg] = React.useState(2.5);
  const need = Math.round(calls * avg * 30 * 0.6); // AI берёт ~60% звонков при переадресации «если не ответили»
  const fit = plans.find((p) => p.minutes >= need) ?? plans.at(-1)!;
  const row = "flex flex-col gap-2 text-[15px]";
  return (
    <div className="mt-6 flex flex-col gap-6 rounded-[24px] bg-[rgba(212,212,212,0.08)] p-7">
      <label className={row}><span className="flex justify-between text-[#c2c2c2]">Звонков в день<span className="tabular-nums text-[#ededed]">{calls}</span></span><input type="range" min={5} max={300} value={calls} onChange={(e) => setCalls(Number(e.target.value))} className="accent-white" /></label>
      <label className={row}><span className="flex justify-between text-[#c2c2c2]">Средняя длительность, мин<span className="tabular-nums text-[#ededed]">{avg}</span></span><input type="range" min={1} max={8} step={0.5} value={avg} onChange={(e) => setAvg(Number(e.target.value))} className="accent-white" /></label>
      <p className="font-display text-[24px] font-medium">Нужно ≈ {need.toLocaleString("ru-RU")} мин/мес</p>
      <p className="text-[15px] text-[#c2c2c2]">Подойдёт тариф «{fit.name}»</p>
    </div>
  );
}
