import "server-only";
import type { Appointment, Ticket } from "@all/db";
import { db, emit } from "./store";

/**
 * Запись и талоны для DATA_SOURCE=mock. Правила повторяют базу:
 * - ресурс не может быть занят дважды (в БД — exclusion constraint appointments_no_overlap);
 * - освободившийся талон сразу предлагается первому в листе ожидания (≤ 1 мин), предложение живёт 15 мин.
 */
const ACTIVE: Appointment["status"][] = ["held", "booked", "blocked"];

export class SlotTaken extends Error {
  constructor(public conflict: Appointment) { super("slot_taken"); }
}

export function findConflict(resourceId: string, startsAt: string, endsAt: string, ignoreId?: string): Appointment | undefined {
  const s = new Date(startsAt).getTime();
  const e = new Date(endsAt).getTime();
  return db.appointments.find((a) => a.id !== ignoreId && a.resourceId === resourceId && ACTIVE.includes(a.status)
    && new Date(a.startsAt).getTime() < e && new Date(a.endsAt).getTime() > s);
}

/** Проверка и запись — одна синхронная операция: одновременная запись из звонка и вручную не создаст дубль */
export function book(a: Omit<Appointment, "id">): Appointment {
  const conflict = findConflict(a.resourceId, a.startsAt, a.endsAt);
  if (conflict) throw new SlotTaken(conflict);
  const appt: Appointment = { ...a, id: `ap_${Math.random().toString(36).slice(2, 9)}` };
  db.appointments.push(appt);
  emit({ type: "appointment.changed", appointment: appt });
  return appt;
}

export function move(id: string, patch: { resourceId?: string; startsAt: string; endsAt: string }): Appointment {
  const appt = db.appointments.find((a) => a.id === id);
  if (!appt) throw new Error("not_found");
  const conflict = findConflict(patch.resourceId ?? appt.resourceId, patch.startsAt, patch.endsAt, id);
  if (conflict) throw new SlotTaken(conflict);
  Object.assign(appt, patch);
  emit({ type: "appointment.changed", appointment: appt });
  return appt;
}

/** Отмена талона → предложение следующему в листе ожидания */
export function releaseTicket(t: Ticket) {
  t.status = "open";
  t.contactName = undefined;
  t.contactPhone = undefined;
  offerNext(t.specialty);
}

export function offerNext(scope: string): boolean {
  const now = Date.now();
  // Просроченные предложения уходят, позиция освобождается
  for (const w of db.waitlist.filter((x) => x.scope === scope && x.status === "offered" && x.expiresAt && new Date(x.expiresAt).getTime() < now)) w.status = "expired";
  const free = db.tickets.find((t) => t.specialty === scope && t.status === "open");
  const next = db.waitlist.filter((w) => w.scope === scope && w.status === "waiting").sort((a, b) => a.position - b.position)[0];
  if (!free || !next) return false;
  free.status = "offered";
  free.contactName = next.contactName;
  free.contactPhone = next.contactPhone;
  next.status = "offered";
  next.offeredAt = new Date(now).toISOString();
  next.expiresAt = new Date(now + 15 * 60_000).toISOString();
  emit({ type: "waitlist.changed" });
  return true;
}
