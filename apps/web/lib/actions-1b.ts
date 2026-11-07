"use server";
import { z } from "zod";
import type { Appointment, Lead } from "@all/db";
import { requireSession, type Session } from "./auth";
import { isSupabase } from "./env";
import { can } from "./permissions";
import { toE164 } from "./format";
import { db, emit, addLeadEvent } from "./data/mock/store";
import { inbound, processBatch, pushMessage } from "./data/mock/chat";
import { book, move, offerNext, releaseTicket, SlotTaken } from "./data/mock/booking";

// Серверные действия фазы 1б: чаты и календарь. Входы валидируются zod, права — как в RLS.
type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
class UserError extends Error {}

async function run<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  // Фаза 1б (чаты, календарь) работает только на mock-хранилище; в Hackathon MVP не подключена к базе
  if (isSupabase) return { ok: false, error: "Недоступно в демо-версии MVP: раздел не подключён к базе." };
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof SlotTaken) return { ok: false, error: `Время занято: ${e.conflict.serviceName ?? e.conflict.note ?? "запись"} ${new Date(e.conflict.startsAt).toLocaleTimeString("ru-RU", { timeZone: "Asia/Bishkek", hour: "2-digit", minute: "2-digit" })}. Выберите другой слот.` };
    if (e instanceof z.ZodError) return { ok: false, error: "Проверьте заполнение полей." };
    const id = Math.random().toString(36).slice(2, 10);
    console.error(`[action] request_id=${id}`, e instanceof Error ? e.message : "unknown");
    return { ok: false, error: `Не получилось. Повторите или напишите в поддержку, код ${id}.` };
  }
}

async function ops(): Promise<Session> {
  const s = await requireSession();
  if (!can(s.member.role, "edit_leads")) throw new UserError("Недостаточно прав.");
  return s;
}

function conv(s: Session, id: string) {
  const c = db.conversations.find((x) => x.id === id);
  if (!c) throw new UserError("Диалог не найден.");
  if (s.member.role === "staff" && c.assigneeId && c.assigneeId !== s.userId) throw new UserError("Этот чат ведёт другой сотрудник.");
  return c;
}

const windowOpen = (c: { channel: string; windowExpiresAt?: string }) =>
  !["whatsapp", "instagram", "facebook"].includes(c.channel) || (!!c.windowExpiresAt && new Date(c.windowExpiresAt).getTime() > Date.now());

// ───────────── Чаты ─────────────

/** «Взять чат»: AI замолкает в этом диалоге, черновики снимаются */
export async function takeChat(id: string) {
  return run(async () => {
    const s = await ops();
    const c = conv(s, id);
    c.state = "operator";
    c.assigneeId = s.userId;
    c.needsHuman = false;
    for (let i = db.messages.length - 1; i >= 0; i--) if (db.messages[i]!.conversationId === id && db.messages[i]!.status === "draft") db.messages.splice(i, 1);
    const t = db.chatTimers.get(id);
    if (t) { clearTimeout(t); db.chatTimers.delete(id); }
    pushMessage(c, { direction: "out", author: "system", body: `${s.member.name} взял(а) чат`, attachments: [], status: "delivered" });
    emit({ type: "conversation.updated", conversation: c });
    return c;
  });
}

export async function returnToAi(id: string) {
  return run(async () => {
    const s = await ops();
    const c = conv(s, id);
    c.state = "ai";
    c.assigneeId = undefined;
    pushMessage(c, { direction: "out", author: "system", body: "Чат возвращён AI", attachments: [], status: "delivered" });
    emit({ type: "conversation.updated", conversation: c });
    return c;
  });
}

/** Режим «черновик»: AI готовит ответы, оператор подтверждает */
export async function setDraftMode(id: string, on: boolean) {
  return run(async () => {
    const s = await ops();
    const c = conv(s, id);
    c.state = on ? "draft" : "ai";
    emit({ type: "conversation.updated", conversation: c });
    if (on) void processBatch(id);
    return c;
  });
}

export async function closeChat(id: string) {
  return run(async () => {
    const s = await ops();
    const c = conv(s, id);
    c.state = "closed";
    c.unread = 0;
    c.needsHuman = false;
    pushMessage(c, { direction: "out", author: "system", body: `Диалог закрыт (${s.member.name})`, attachments: [], status: "delivered" });
    emit({ type: "conversation.updated", conversation: c });
    return c;
  });
}

export async function markRead(id: string) {
  return run(async () => {
    const s = await requireSession();
    const c = conv(s, id);
    c.unread = 0;
  });
}

const sendSchema = z.object({ body: z.string().trim().min(1).max(4000), template: z.string().optional(), attachments: z.array(z.object({ kind: z.enum(["image", "file"]), name: z.string().max(200) })).max(10).default([]) });

/** Ответ оператора. Вне 24-часового окна — только одобренные шаблоны. Оператор, ответивший в чате AI, забирает его. */
export async function sendMessage(id: string, input: z.input<typeof sendSchema>) {
  return run(async () => {
    const s = await ops();
    const c = conv(s, id);
    const v = sendSchema.parse(input);
    if (!windowOpen(c) && !v.template) throw new UserError("24-часовое окно закрыто: можно отправить только одобренный шаблон.");
    if (v.template && !db.templates.some((t) => t.key === v.template)) throw new UserError("Шаблон не найден.");
    if (c.state !== "operator") {
      c.state = "operator";
      c.assigneeId = s.userId;
      pushMessage(c, { direction: "out", author: "system", body: `${s.member.name} взял(а) чат`, attachments: [], status: "delivered" });
    }
    c.needsHuman = false;
    c.unread = 0;
    const msg = pushMessage(c, { direction: "out", author: "operator", authorId: s.userId, body: v.body, attachments: v.attachments, status: "sent" });
    setTimeout(() => { msg.status = "delivered"; }, 800);
    emit({ type: "conversation.updated", conversation: c });
    return msg;
  });
}

/** Черновик AI: «Отправить» как есть или после правки */
export async function approveDraft(id: string, messageId: string, editedBody?: string) {
  return run(async () => {
    const s = await ops();
    const c = conv(s, id);
    const m = db.messages.find((x) => x.id === messageId && x.conversationId === id && x.status === "draft");
    if (!m) throw new UserError("Черновик уже отправлен или устарел.");
    if (!windowOpen(c)) throw new UserError("24-часовое окно закрыто: можно отправить только одобренный шаблон.");
    const body = z.string().trim().min(1).max(4000).parse(editedBody ?? m.body);
    db.messages.splice(db.messages.indexOf(m), 1);
    const sent = pushMessage(c, { direction: "out", author: editedBody && editedBody !== m.body ? "operator" : "ai", authorId: s.userId, body, attachments: [], status: "sent" });
    c.needsHuman = false;
    emit({ type: "conversation.updated", conversation: c });
    return sent;
  });
}

export async function createLeadFromChat(id: string, title: string) {
  return run(async () => {
    const s = await ops();
    const c = conv(s, id);
    const number = db.leads.reduce((m, l) => Math.max(m, l.number), 0) + 1;
    const now = new Date().toISOString();
    const lead: Lead = {
      id: `ld_${number}`, number, source: "chat", sourceId: c.id, channel: c.channel, type: "booking", title: z.string().trim().min(2).max(200).parse(title),
      status: "new", priority: "normal", tags: [], contactId: c.contactId, contactName: c.contactName, contactPhone: c.contactPhone, assigneeId: s.userId,
      dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(), payload: {}, createdAt: now, updatedAt: now,
    };
    db.leads.unshift(lead);
    addLeadEvent({ leadId: lead.id, actorId: s.userId, actorKind: "user", action: "created" });
    emit({ type: "lead.created", lead });
    pushMessage(c, { direction: "out", author: "system", body: `Создана заявка №${number}`, attachments: [], status: "delivered" });
    return lead;
  });
}

/** Тестовое сообщение «от клиента» — проверить поведение AI в канале (кабинет, демо-режим) */
export async function simulateClientMessage(input: { conversationId?: string; channel: "widget" | "telegram" | "whatsapp"; body: string; contactId?: string }) {
  return run(async () => {
    await ops();
    const v = z.object({ conversationId: z.string().optional(), channel: z.enum(["widget", "telegram", "whatsapp"]), body: z.string().trim().min(1).max(1000), contactId: z.string().optional() }).parse(input);
    return inbound({ channel: v.channel, conversationId: v.conversationId, contactId: v.contactId ?? db.contacts[0]!.id, body: v.body });
  });
}

// ───────────── Календарь ─────────────
const apptSchema = z.object({
  resourceId: z.string(),
  serviceId: z.string().optional(),
  startsAt: z.string().datetime(),
  durationMin: z.number().int().min(15).max(720),
  contactName: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().optional(),
  note: z.string().max(500).optional(),
  block: z.boolean().default(false),
});

export async function createAppointment(input: z.input<typeof apptSchema>) {
  return run(async () => {
    const s = await ops();
    const v = apptSchema.parse(input);
    if (!db.resources.some((r) => r.id === v.resourceId)) throw new UserError("Ресурс не найден.");
    const start = new Date(v.startsAt).getTime();
    if (start % (15 * 60_000) !== 0) throw new UserError("Шаг записи — 15 минут.");
    let contact = undefined as (typeof db.contacts)[number] | undefined;
    if (!v.block) {
      const phone = v.contactPhone ? toE164(v.contactPhone) : null;
      if (!phone) throw new UserError("Укажите телефон клиента в формате +996 …");
      contact = db.contacts.find((c) => c.phone === phone);
      if (!contact) {
        contact = { id: `ct_${Math.random().toString(36).slice(2, 9)}`, phone, name: v.contactName || undefined, channels: ["phone"], tags: [], lastSeenAt: new Date().toISOString(), interactionsCount: 0, createdAt: new Date().toISOString() };
        db.contacts.unshift(contact);
      }
    }
    const sv = db.services.find((x) => x.id === v.serviceId);
    const appt = book({
      resourceId: v.resourceId, serviceId: sv?.id, serviceName: sv?.name, contactId: contact?.id, contactName: contact?.name ?? contact?.phone, contactPhone: contact?.phone,
      startsAt: new Date(start).toISOString(), endsAt: new Date(start + v.durationMin * 60_000).toISOString(),
      status: v.block ? "blocked" : "booked", createdByAi: false, note: v.note,
    });
    void s;
    return appt;
  });
}

/** Перенос перетаскиванием (другое время или другой ресурс) */
export async function moveAppointment(id: string, patch: { resourceId?: string; startsAt: string; durationMin?: number }) {
  return run(async () => {
    await ops();
    const a = db.appointments.find((x) => x.id === id);
    if (!a) throw new UserError("Запись не найдена.");
    if (a.status === "done" || a.status === "no_show") throw new UserError("Прошедшую запись нельзя перенести.");
    const dur = patch.durationMin ?? (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000;
    const start = new Date(z.string().datetime().parse(patch.startsAt)).getTime();
    return move(id, { resourceId: patch.resourceId, startsAt: new Date(start).toISOString(), endsAt: new Date(start + dur * 60_000).toISOString() });
  });
}

export async function setAppointmentStatus(id: string, status: Appointment["status"]) {
  return run(async () => {
    await ops();
    const a = db.appointments.find((x) => x.id === id);
    if (!a) throw new UserError("Запись не найдена.");
    a.status = z.enum(["booked", "cancelled", "done", "no_show"]).parse(status);
    emit({ type: "appointment.changed", appointment: a });
    return a;
  });
}

// ───────────── Талоны и лист ожидания ─────────────
export async function cancelTicket(id: string) {
  return run(async () => {
    await ops();
    const t = db.tickets.find((x) => x.id === id);
    if (!t || (t.status !== "taken" && t.status !== "offered")) throw new UserError("Талон не занят.");
    releaseTicket(t); // освободившийся талон сразу предлагается первому в листе
    return t;
  });
}

export async function offerToNext(scope: string) {
  return run(async () => {
    await ops();
    if (!offerNext(z.string().parse(scope))) throw new UserError("Свободных талонов или ожидающих нет.");
  });
}

export async function addToWaitlist(input: { scope: string; contactName: string; contactPhone: string }) {
  return run(async () => {
    await ops();
    const v = z.object({ scope: z.string().min(2), contactName: z.string().trim().min(2).max(100), contactPhone: z.string() }).parse(input);
    const phone = toE164(v.contactPhone);
    if (!phone) throw new UserError("Телефон указан неверно.");
    if (db.waitlist.some((w) => w.scope === v.scope && w.contactPhone === phone && (w.status === "waiting" || w.status === "offered"))) throw new UserError("Клиент уже в листе ожидания.");
    const position = db.waitlist.filter((w) => w.scope === v.scope && w.status === "waiting").length + 1;
    db.waitlist.push({ id: `wl_${Math.random().toString(36).slice(2, 9)}`, scope: v.scope, contactName: v.contactName, contactPhone: phone, position, status: "waiting", createdAt: new Date().toISOString() });
    offerNext(v.scope);
    emit({ type: "waitlist.changed" });
  });
}

export async function resolveOffer(id: string, accepted: boolean) {
  return run(async () => {
    await ops();
    const w = db.waitlist.find((x) => x.id === id && x.status === "offered");
    if (!w) throw new UserError("Предложение не найдено.");
    const t = db.tickets.find((x) => x.status === "offered" && x.specialty === w.scope && x.contactPhone === w.contactPhone);
    if (accepted) {
      w.status = "accepted";
      if (t) t.status = "taken";
    } else {
      w.status = "removed";
      if (t) releaseTicket(t);
    }
    // позиции оставшихся пересчитываются
    db.waitlist.filter((x) => x.scope === w.scope && x.status === "waiting").sort((a, b) => a.position - b.position).forEach((x, i) => (x.position = i + 1));
    emit({ type: "waitlist.changed" });
  });
}
