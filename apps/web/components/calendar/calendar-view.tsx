"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bot, Check, ChevronLeft, ChevronRight, Lock, Phone, Plus, Ticket as TicketIcon, UserPlus, UserX, X } from "lucide-react";
import { Button, CardAction, Checkbox, Field, Input, KanbanBoard, PageHeader, Pill, SectionTitle, Segmented, Select, Textarea, cn, toast, type KanbanColumn, type Tone } from "@all/ui";
import type { Appointment, Resource, Ticket, WaitlistEntry } from "@all/db";
import { addToWaitlist, cancelTicket, createAppointment, moveAppointment, offerToNext, resolveOffer, setAppointmentStatus } from "@/lib/actions-1b";
import { useRealtime } from "@/lib/use-realtime";
import { formatPhone, formatTime } from "@/lib/format";

type Data = {
  resources: Resource[];
  appointments: Appointment[];
  services: { id: string; name: string; durationMin: number }[];
  tickets: Ticket[];
  waitlist: WaitlistEntry[];
  branches: { id: string; name: string }[];
};

const TZ_H = 6; // Asia/Bishkek
const STEP = 15;
const DAY_START = 8;
const DAY_END = 21;
const ROW_PX = 14; // высота 15-минутного слота
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** Начало локального дня (Бишкек) в UTC-мс */
function dayStart(t: number) {
  const local = new Date(t + TZ_H * HOUR);
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() - TZ_H * HOUR;
}
const localDate = (t: number) => new Date(t + TZ_H * HOUR);

// Цвет по услуге — из нейтральной палитры (design.md: без новых брендовых цветов), различимы яркостью и штриховкой
const SERVICE_SHADES = ["rgba(237,237,237,0.16)", "rgba(237,237,237,0.10)", "rgba(143,179,255,0.16)", "rgba(60,203,127,0.14)", "rgba(245,165,36,0.14)", "rgba(237,237,237,0.22)"];
const shadeFor = (id?: string) => SERVICE_SHADES[id ? Math.abs([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 0)) % SERVICE_SHADES.length : 0]!;
const STATUS_TONE: Record<Appointment["status"], Tone> = { held: "warning", booked: "info", cancelled: "neutral", done: "success", no_show: "danger", blocked: "neutral" };

export function CalendarView({ data: initial }: { data: Data }) {
  const t = useTranslations("calendar");
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  React.useEffect(() => setData(initial), [initial]);
  const [mode, setMode] = React.useState<"appointments" | "tickets">("appointments");
  const [view, setView] = React.useState<"day" | "week" | "board">("day");
  const [day, setDay] = React.useState(() => dayStart(Date.now()));
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Appointment | null>(null);
  const [draft, setDraft] = React.useState<{ resourceId: string; startsAt: number } | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);

  useRealtime((e) => {
    if (e.type === "appointment.changed") {
      setData((d) => ({ ...d, appointments: [...d.appointments.filter((a) => a.id !== e.appointment.id), e.appointment].filter((a) => a.status !== "cancelled") }));
    }
    if (e.type === "waitlist.changed") router.refresh();
  });

  const resources = data.resources.filter((r) => !hidden.has(r.id));
  const days = view !== "week" ? [day] : Array.from({ length: 7 }, (_, i) => dayStart(day - ((localDate(day).getUTCDay() + 6) % 7) * 24 * HOUR) + i * 24 * HOUR);
  const columns = days.flatMap((d) => resources.map((r) => ({ day: d, resource: r })));

  const onMove = async (a: Appointment, resourceId: string, startsAt: number) => {
    const prev = a;
    const dur = new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime();
    const next = { ...a, resourceId, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(startsAt + dur).toISOString() };
    setData((d) => ({ ...d, appointments: d.appointments.map((x) => (x.id === a.id ? next : x)) }));
    const r = await moveAppointment(a.id, { resourceId, startsAt: next.startsAt });
    if (!r.ok) { setData((d) => ({ ...d, appointments: d.appointments.map((x) => (x.id === a.id ? prev : x)) })); toast.error(r.error); return; }
    toast(t("moved"), { undo: async () => { await moveAppointment(a.id, { resourceId: prev.resourceId, startsAt: prev.startsAt }); router.refresh(); } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")}>
        <Segmented label="Режим" value={mode} onChange={setMode} items={[{ value: "appointments", label: t("mode.appointments") }, { value: "tickets", label: t("mode.tickets"), icon: <TicketIcon /> }]} />
        {mode === "appointments" && <>
          <Segmented label="Масштаб" value={view} onChange={setView} items={[{ value: "day", label: t("day") }, { value: "week", label: t("week") }, { value: "board", label: t("board") }]} />
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => { const r = resources[0]; if (r) setDraft({ resourceId: r.id, startsAt: day + 10 * HOUR }); }}>{t("newAppt")}</Button>
        </>}
      </PageHeader>
      {mode === "tickets" ? <TicketsMode tickets={data.tickets} waitlist={data.waitlist} /> : (
        <div className="flex min-h-0 flex-1">
          {/* Слева: мини-календарь и ресурсы 220px */}
          <aside className="flex w-[220px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-3 max-lg:hidden">
            <MiniCalendar day={day} onPick={setDay} appointments={data.appointments} />
            <div>
              <SectionTitle>{t("resources")}</SectionTitle>
              {data.resources.map((r) => (
                <label key={r.id} className="flex h-7 items-center gap-2 text-[13px]">
                  <Checkbox checked={!hidden.has(r.id)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-[11px] tabular-nums text-fg-faint">{data.appointments.filter((a) => a.resourceId === r.id && dayStart(new Date(a.startsAt).getTime()) === day && a.status !== "blocked").length}</span>
                </label>
              ))}
            </div>
            <div className="text-[11px] leading-4 text-fg-faint">{t("dragHint")}. {t("legend")}.</div>
            <div className="flex flex-col gap-1.5">
              {data.services.slice(0, 6).map((s) => <span key={s.id} className="flex items-center gap-2 text-[11px] text-fg-muted"><span className="size-2.5 rounded-[3px]" style={{ background: shadeFor(s.id) }} />{s.name}</span>)}
            </div>
          </aside>

          {/* Центр: сетка ресурсов */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
              <Button size="icon-sm" variant="ghost" aria-label="Назад" onClick={() => setDay((d) => d - (view === "week" ? 7 : 1) * 24 * HOUR)}><ChevronLeft /></Button>
              <Button size="sm" onClick={() => setDay(dayStart(Date.now()))}>{t("today")}</Button>
              <Button size="icon-sm" variant="ghost" aria-label="Вперёд" onClick={() => setDay((d) => d + (view === "week" ? 7 : 1) * 24 * HOUR)}><ChevronRight /></Button>
              <span className="text-[13px] font-medium">{new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", weekday: "long", day: "numeric", month: "long" }).format(new Date(day))}</span>
            </div>
            {view === "board" ? (
              <DayBoard day={day} now={now} appointments={data.appointments.filter((a) => !hidden.has(a.resourceId))} resources={data.resources} selectedId={selected?.id} onOpen={setSelected}
                onChanged={(a) => setData((d) => ({ ...d, appointments: d.appointments.map((x) => (x.id === a.id ? a : x)).filter((x) => x.status !== "cancelled") }))} />
            ) : (
              <Grid columns={columns} appointments={data.appointments} now={now} multiDay={view === "week"}
                onSelect={setSelected} onSlot={(resourceId, startsAt) => setDraft({ resourceId, startsAt })} onMove={onMove} selectedId={selected?.id} />
            )}
          </div>

          {/* Справа: панель записи */}
          {(selected || draft) && (
            <aside className="flex w-[340px] shrink-0 flex-col border-l border-line max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-full max-md:bg-app">
              {draft ? (
                <NewAppointment key={`${draft.resourceId}_${draft.startsAt}`} draft={draft} resources={data.resources} services={data.services} onClose={() => setDraft(null)}
                  onCreated={(a) => { setData((d) => ({ ...d, appointments: [...d.appointments.filter((x) => x.id !== a.id), a] })); setDraft(null); setSelected(a); }} />
              ) : selected ? (
                <AppointmentPanel key={selected.id} a={data.appointments.find((x) => x.id === selected.id) ?? selected} resource={data.resources.find((r) => r.id === selected.resourceId)} onClose={() => setSelected(null)}
                  onChanged={(a) => { setData((d) => ({ ...d, appointments: d.appointments.map((x) => (x.id === a.id ? a : x)).filter((x) => x.status !== "cancelled") })); if (a.status === "cancelled") setSelected(null); }} />
              ) : null}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Grid({ columns, appointments, now, multiDay, onSelect, onSlot, onMove, selectedId }: {
  columns: { day: number; resource: Resource }[]; appointments: Appointment[]; now: number; multiDay: boolean; selectedId?: string;
  onSelect: (a: Appointment) => void; onSlot: (resourceId: string, startsAt: number) => void; onMove: (a: Appointment, resourceId: string, startsAt: number) => void;
}) {
  const t = useTranslations("calendar");
  const slots = (DAY_END - DAY_START) * (60 / STEP);
  const [drag, setDrag] = React.useState<{ id: string; resourceId: string; day: number; slot: number } | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = localDate(now).getUTCHours();
    scroller.current?.scrollTo({ top: Math.max(0, (h - DAY_START - 1) * 4 * ROW_PX) });
  }, [now]);
  const slotTime = (day: number, slot: number) => day + (DAY_START * 60 + slot * STEP) * MIN;
  const colW = multiDay ? 120 : 180;

  return (
    <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
      <div className="grid" style={{ gridTemplateColumns: `48px repeat(${columns.length}, minmax(${colW}px, 1fr))` }}>
        {/* Шапка ресурсов */}
        <div className="sticky left-0 top-0 z-20 h-10 border-b border-r border-line bg-subtle" />
        {columns.map((c) => (
          <div key={`${c.day}_${c.resource.id}`} className="sticky top-0 z-10 flex h-10 flex-col justify-center border-b border-r border-line bg-subtle px-2">
            <span className="truncate text-[13px] font-medium">{c.resource.name}</span>
            {multiDay && <span className="text-[10px] text-fg-muted">{DAYS_RU[localDate(c.day).getUTCDay()]} {localDate(c.day).getUTCDate()}</span>}
          </div>
        ))}
        {/* Шкала времени */}
        <div className="sticky left-0 z-10 border-r border-line bg-app">
          {Array.from({ length: DAY_END - DAY_START }, (_, i) => (
            <div key={i} className="relative border-b border-line text-right" style={{ height: ROW_PX * 4 }}>
              <span className="absolute -top-2 right-1.5 text-[10px] tabular-nums text-fg-faint">{i ? `${DAY_START + i}:00` : ""}</span>
            </div>
          ))}
        </div>
        {columns.map((c) => {
          const colAppts = appointments.filter((a) => a.resourceId === c.resource.id && dayStart(new Date(a.startsAt).getTime()) === c.day);
          const nowOffset = dayStart(now) === c.day ? Math.round(((Math.floor(now / MIN) * MIN - c.day) / MIN - DAY_START * 60) / STEP * ROW_PX) : -1;
          return (
            <div key={`${c.day}_${c.resource.id}`} className="relative border-r border-line" style={{ height: slots * ROW_PX }}
              onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const slot = Math.max(0, Math.min(slots - 1, Math.floor((e.clientY - r.top) / ROW_PX))); setDrag((d) => d && { ...d, resourceId: c.resource.id, day: c.day, slot }); }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/appt");
                const a = appointments.find((x) => x.id === id);
                const r = e.currentTarget.getBoundingClientRect();
                const grab = Number(e.dataTransfer.getData("text/offset") || 0);
                const slot = Math.max(0, Math.floor((e.clientY - r.top - grab) / ROW_PX));
                setDrag(null);
                if (a) onMove(a, c.resource.id, slotTime(c.day, slot));
              }}>
              {/* Слоты: свободные подсвечиваются при наведении, клик — новая запись */}
              {Array.from({ length: slots }, (_, s) => {
                const tStart = slotTime(c.day, s);
                const busy = colAppts.some((a) => new Date(a.startsAt).getTime() < tStart + STEP * MIN && new Date(a.endsAt).getTime() > tStart);
                const past = tStart + STEP * MIN < now;
                return (
                  <button key={s} type="button" disabled={busy || past} aria-label={`${c.resource.name} ${formatTime(new Date(tStart).toISOString())}`}
                    onClick={() => onSlot(c.resource.id, tStart)}
                    className={cn("block w-full", s % 4 === 3 ? "border-b border-line" : "border-b border-line/40", !busy && !past && "hover:bg-success-bg", past && "bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,var(--bg-hover)_4px,var(--bg-hover)_5px)]")}
                    style={{ height: ROW_PX }} />
                );
              })}
              {drag && drag.resourceId === c.resource.id && drag.day === c.day && (
                <div className="pointer-events-none absolute inset-x-1 rounded-[6px] border border-dashed border-fg-muted" style={{ top: drag.slot * ROW_PX, height: 4 * ROW_PX }} />
              )}
              {nowOffset >= 0 && <div className="pointer-events-none absolute inset-x-0 z-[5] h-px bg-danger" style={{ top: nowOffset }}><span className="absolute -left-1 -top-1 size-2 rounded-full bg-danger" /></div>}
              {colAppts.map((a) => {
                const top = ((new Date(a.startsAt).getTime() - c.day) / MIN - DAY_START * 60) / STEP * ROW_PX;
                const h = Math.min(slots * ROW_PX - top - 2, Math.max(ROW_PX * 2, (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / MIN / STEP * ROW_PX - 2));
                const blocked = a.status === "blocked";
                return (
                  <button key={a.id} type="button" draggable={!blocked && a.status === "booked"}
                    onDragStart={(e) => { e.dataTransfer.setData("text/appt", a.id); e.dataTransfer.setData("text/offset", String(e.clientY - e.currentTarget.getBoundingClientRect().top)); setDrag({ id: a.id, resourceId: c.resource.id, day: c.day, slot: 0 }); }}
                    onDragEnd={() => setDrag(null)}
                    onClick={() => onSelect(a)}
                    className={cn("absolute inset-x-1 z-[6] flex flex-col overflow-hidden rounded-[6px] border px-1.5 py-0.5 text-left text-[11px] leading-[14px]",
                      blocked ? "border-line bg-[repeating-linear-gradient(135deg,var(--bg-subtle),var(--bg-subtle)_5px,var(--bg-active)_5px,var(--bg-active)_10px)] text-fg-muted" : "border-line-strong text-fg",
                      a.status === "done" && "opacity-60", a.status === "no_show" && "line-through opacity-60", selectedId === a.id && "ring-1 ring-fg")}
                    style={{ top, height: h, background: blocked ? undefined : shadeFor(a.serviceId) }}>
                    <span className="flex items-center gap-1 font-medium">
                      <span className="tabular-nums">{formatTime(a.startsAt)}</span>
                      {blocked ? <><Lock className="size-3" />{a.note ?? t("blocked")}</> : <span className="truncate">{a.serviceName}</span>}
                      {a.createdByAi && <Bot className="ml-auto size-3 shrink-0 text-fg-secondary" aria-label={t("createdByAi")} />}
                    </span>
                    {!blocked && <span className="truncate text-fg-muted">{a.contactName}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DayCol = "upcoming" | "soon" | "done" | "no_show";

/** Доска дня для ресепшена: кто скоро придёт, кто пришёл, кто не пришёл — отметка одним кликом или перетаскиванием */
function DayBoard({ day, now, appointments, resources, selectedId, onOpen, onChanged }: { day: number; now: number; appointments: Appointment[]; resources: Resource[]; selectedId?: string; onOpen: (a: Appointment) => void; onChanged: (a: Appointment) => void }) {
  const t = useTranslations("calendar");
  const items = appointments.filter((a) => dayStart(new Date(a.startsAt).getTime()) === day && a.status !== "blocked" && a.status !== "cancelled")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const colOf = (a: Appointment): DayCol =>
    a.status === "done" ? "done" : a.status === "no_show" ? "no_show" : new Date(a.startsAt).getTime() - now <= 30 * MIN ? "soon" : "upcoming";
  const columns: KanbanColumn<DayCol>[] = [
    { key: "upcoming", label: t("boardCols.upcoming"), tone: "neutral", hint: t("boardHints.upcoming") },
    { key: "soon", label: t("boardCols.soon"), tone: "warning", hint: t("boardHints.soon") },
    { key: "done", label: t("boardCols.done"), tone: "success" },
    { key: "no_show", label: t("boardCols.no_show"), tone: "danger", hint: t("boardHints.no_show") },
  ];
  const set = async (a: Appointment, status: Appointment["status"]) => {
    const prev = a.status;
    onChanged({ ...a, status });
    const r = await setAppointmentStatus(a.id, status);
    if (!r.ok) { onChanged({ ...a, status: prev }); toast.error(r.error); return; }
    toast(t(`status.${status}`), { undo: async () => { onChanged({ ...a, status: prev }); await setAppointmentStatus(a.id, prev); } });
  };
  return (
    <KanbanBoard columns={columns} items={items} getId={(a) => a.id} getColumn={colOf} activeId={selectedId} onOpen={onOpen} storageKey="calendar:board"
      isUrgent={(a) => a.status === "booked" && new Date(a.startsAt).getTime() < now - 10 * MIN}
      onMove={(a, to) => set(a, to === "done" ? "done" : to === "no_show" ? "no_show" : "booked")}
      renderCard={(a) => {
        const late = a.status === "booked" && new Date(a.startsAt).getTime() < now - 10 * MIN;
        return (
          <>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="font-medium tabular-nums text-fg">{formatTime(a.startsAt)}</span>
              <span className="truncate text-fg-faint">{resources.find((r) => r.id === a.resourceId)?.name}</span>
              {late && <span className="ml-auto text-danger">{t("late")}</span>}
              {a.createdByAi && !late && <Bot className="ml-auto size-3 text-fg-muted" aria-label={t("createdByAi")} />}
            </div>
            <p className="mt-0.5 truncate text-[13px]">{a.serviceName}</p>
            <p className="truncate text-xs text-fg-muted">{a.contactName}</p>
            {a.status === "booked" && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <CardAction primary onClick={() => set(a, "done")}><Check />{t("markDone")}</CardAction>
                <CardAction onClick={() => set(a, "no_show")}><UserX />{t("markNoShow")}</CardAction>
                {a.contactPhone && <CardAction onClick={() => { window.location.href = `tel:${a.contactPhone}`; }}><Phone /></CardAction>}
              </div>
            )}
          </>
        );
      }} />
  );
}

function MiniCalendar({ day, onPick, appointments }: { day: number; onPick: (d: number) => void; appointments: Appointment[] }) {
  const [month, setMonth] = React.useState(() => { const d = localDate(day); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); });
  const m = new Date(month);
  const firstDow = (m.getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
  const today = dayStart(Date.now());
  const busy = new Set(appointments.filter((a) => a.status !== "blocked").map((a) => dayStart(new Date(a.startsAt).getTime())));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <button aria-label="Предыдущий месяц" onClick={() => setMonth(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1))} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-hover"><ChevronLeft className="size-3.5" /></button>
        <span className="text-xs font-medium capitalize">{new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(m)}</span>
        <button aria-label="Следующий месяц" onClick={() => setMonth(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-hover"><ChevronRight className="size-3.5" /></button>
      </div>
      <div className="grid grid-cols-7 gap-px text-center text-[10px] text-fg-faint">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-px">
        {Array.from({ length: firstDow }, (_, i) => <span key={`e${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const d = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), i + 1) - TZ_H * HOUR;
          return (
            <button key={i} onClick={() => onPick(d)} className={cn("relative h-7 rounded-md text-xs tabular-nums", d === day ? "bg-accent text-accent-fg" : "hover:bg-hover", d === today && d !== day && "font-semibold text-fg underline")}>
              {i + 1}{busy.has(d) && d !== day && <span className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-fg-muted" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewAppointment({ draft, resources, services, onClose, onCreated }: { draft: { resourceId: string; startsAt: number }; resources: Resource[]; services: Data["services"]; onClose: () => void; onCreated: (a: Appointment) => void }) {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const [block, setBlock] = React.useState(false);
  const [resourceId, setResourceId] = React.useState(draft.resourceId);
  const [serviceId, setServiceId] = React.useState(services[0]?.id ?? "");
  const [time, setTime] = React.useState(() => { const d = localDate(draft.startsAt); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; });
  const [duration, setDuration] = React.useState(services[0]?.durationMin ?? 60);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, start] = React.useTransition();
  const submit = () => start(async () => {
    const [h, mm] = time.split(":").map(Number);
    const startsAt = dayStart(draft.startsAt) + ((h ?? 0) * 60 + (mm ?? 0)) * MIN;
    const r = await createAppointment({ resourceId, serviceId: block ? undefined : serviceId, startsAt: new Date(startsAt).toISOString(), durationMin: Math.max(15, Math.round(duration / 15) * 15), contactName: name, contactPhone: phone, note, block });
    if (!r.ok) { setError(r.error); return; }
    toast.success(t("created"));
    onCreated(r.data!);
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[13px] font-medium">{block ? t("block") : t("newAppt")}</h2>
        <button onClick={onClose} aria-label={tc("close")} className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><X className="size-4" /></button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <Segmented label="Тип" value={block ? "block" : "appt"} onChange={(v) => setBlock(v === "block")} items={[{ value: "appt", label: t("newAppt") }, { value: "block", label: t("block") }]} />
        <Field label={t("staff")}><Select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>{resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        {!block && <Field label={t("service")}><Select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setDuration(services.find((s) => s.id === e.target.value)?.durationMin ?? 60); }}>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("start")}><Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label={t("duration")}><Input type="number" min={15} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
        </div>
        {!block && <>
          <Field label={t("client")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("phone")}><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+996 555 123 456" /></Field>
        </>}
        <Field label={t("note")}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={block ? "Обед, выходной, ремонт подъёмника" : ""} /></Field>
        {error && <p className="rounded-[10px] bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">{error}</p>}
        <Button variant="primary" loading={pending} className="mt-auto justify-center">{tc("create")}</Button>
      </form>
    </div>
  );
}

function AppointmentPanel({ a, resource, onClose, onChanged }: { a: Appointment; resource?: Resource; onClose: () => void; onChanged: (a: Appointment) => void }) {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const set = async (status: Appointment["status"]) => { const r = await setAppointmentStatus(a.id, status); if (r.ok) onChanged(r.data!); else toast.error(r.error); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="truncate text-[13px] font-medium">{a.status === "blocked" ? t("blocked") : a.serviceName}</h2>
        <button onClick={onClose} aria-label={tc("close")} className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><X className="size-4" /></button>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={STATUS_TONE[a.status]}>{t(`status.${a.status}`)}</Pill>
          {a.createdByAi && <Pill tone="neutral"><Bot className="mr-0.5 inline size-3" />{t("createdByAi")}</Pill>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-xs text-fg-muted">{t("staff")}</dt><dd>{resource?.name}</dd>
          <dt className="text-xs text-fg-muted">{t("start")}</dt><dd className="tabular-nums">{new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(a.startsAt))} – {formatTime(a.endsAt)}</dd>
          {a.contactName && <><dt className="text-xs text-fg-muted">{t("client")}</dt><dd>{a.contactName}</dd></>}
          {a.contactPhone && <><dt className="text-xs text-fg-muted">{t("phone")}</dt><dd><a href={`tel:${a.contactPhone}`} className="tabular-nums hover:underline">{formatPhone(a.contactPhone)}</a></dd></>}
          {a.note && <><dt className="text-xs text-fg-muted">{t("note")}</dt><dd>{a.note}</dd></>}
        </dl>
        {a.status === "booked" && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => set("done")}>{t("markDone")}</Button>
            <Button size="sm" onClick={() => set("no_show")}>{t("markNoShow")}</Button>
            <Button size="sm" variant="danger" onClick={() => set("cancelled")}>{t("cancel")}</Button>
          </div>
        )}
        {a.status === "blocked" && <Button size="sm" variant="danger" className="w-fit" onClick={() => set("cancelled")}>Снять блокировку</Button>}
        <p className="text-[11px] text-fg-faint">{t("dragHint")}</p>
      </div>
    </div>
  );
}

/** Режим «Талоны» (поликлиники): партии талонов с временем открытия, «талонов нет», лист ожидания по специальностям */
function TicketsMode({ tickets, waitlist }: { tickets: Ticket[]; waitlist: WaitlistEntry[] }) {
  const t = useTranslations("calendar");
  const router = useRouter();
  const doctors = Array.from(new Map(tickets.map((x) => [x.doctor, x.specialty])).entries());
  const scopes = Array.from(new Set([...tickets.map((x) => x.specialty), ...waitlist.map((w) => w.scope)]));
  const [form, setForm] = React.useState({ scope: scopes[0] ?? "", contactName: "", contactPhone: "" });
  const act = async (p: Promise<{ ok: boolean; error?: string }>) => { const r = await p; if (!r.ok) toast.error(r.error ?? ""); router.refresh(); };
  return (
    <div className="flex min-h-0 flex-1 max-lg:flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="mb-3 text-xs text-fg-muted">{t("polyclinicNote")}</p>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {doctors.map(([doctor, specialty]) => {
            const list = tickets.filter((x) => x.doctor === doctor);
            const open = list.filter((x) => x.status === "open").length;
            return (
              <section key={doctor} className="rounded-[12px] border border-line bg-bg">
                <header className="flex h-10 items-center gap-2 border-b border-line px-3">
                  <span className="text-[13px] font-medium">{doctor}</span><span className="text-xs text-fg-muted">{specialty}</span>
                  <span className="ml-auto">{open ? <Pill tone="success">{t("ticketsOpen", { count: open })}</Pill> : <Pill tone="danger">{t("noTickets")}</Pill>}</span>
                </header>
                <div className="px-3 pt-2 text-[11px] text-fg-faint">{t("opensAt", { time: formatTime(list[0]!.opensAt) })} · {new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short" }).format(new Date(list[0]!.startsAt))}</div>
                <ul className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-4">
                  {list.map((tk) => (
                    <li key={tk.id} className={cn("flex flex-col rounded-[8px] border px-2 py-1 text-xs", tk.status === "open" ? "border-success/40 bg-success-bg" : tk.status === "offered" ? "border-warning/40 bg-warning-bg" : "border-line")}>
                      <span className="font-medium tabular-nums">{formatTime(tk.startsAt)}</span>
                      <span className="truncate text-[11px] text-fg-muted">{tk.status === "open" ? t("free") : tk.contactName}</span>
                      {(tk.status === "taken" || tk.status === "offered") && <button onClick={() => act(cancelTicket(tk.id))} className="mt-0.5 w-fit text-[10px] text-fg-faint underline hover:text-fg">{t("releaseTicket")}</button>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line max-lg:w-full max-lg:border-l-0 max-lg:border-t">
        <div className="flex h-11 shrink-0 items-center border-b border-line px-3 text-[13px] font-medium">{t("waitlist")}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {scopes.map((sc) => {
            const list = waitlist.filter((w) => w.scope === sc);
            return (
              <section key={sc} className="border-b border-line px-3 py-2">
                <SectionTitle aside={<Button size="sm" variant="ghost" onClick={() => act(offerToNext(sc))}>{t("offerNext")}</Button>}>{sc} · {list.length}</SectionTitle>
                <ol className="flex flex-col">
                  {list.length === 0 && <li className="text-xs text-fg-faint">—</li>}
                  {list.map((w) => (
                    <li key={w.id} className="flex min-h-8 items-center gap-2 text-[13px]">
                      <span className="w-5 text-xs tabular-nums text-fg-faint">{w.status === "offered" ? "→" : w.position}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate">{w.contactName}</span>
                        {w.status === "offered" && <span className="block text-[11px] text-warning">{t("offered", { time: formatTime(w.expiresAt!) })}</span>}
                      </span>
                      {w.status === "offered" && <>
                        <Button size="sm" variant="primary" onClick={() => act(resolveOffer(w.id, true))}>{t("accept")}</Button>
                        <Button size="sm" onClick={() => act(resolveOffer(w.id, false))}>{t("decline")}</Button>
                      </>}
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
        <form className="flex shrink-0 flex-col gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void act(addToWaitlist(form)).then(() => setForm({ ...form, contactName: "", contactPhone: "" })); }}>
          <SectionTitle>{t("addWaitlist")}</SectionTitle>
          <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} aria-label={t("specialty")}>{scopes.map((s) => <option key={s}>{s}</option>)}</Select>
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder={t("client")} />
            <Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="+996 …" />
          </div>
          <Button variant="primary" icon={<UserPlus />} disabled={form.contactName.length < 2 || form.contactPhone.length < 6}>{t("addWaitlist")}</Button>
        </form>
      </aside>
    </div>
  );
}
