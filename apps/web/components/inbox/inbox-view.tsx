"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Bot, Check, CheckCheck, KanbanSquare, List, ChevronLeft, Clock, FileText, Hand, Image as ImageIcon, Lock, Mic, PanelRightClose, PanelRightOpen, Paperclip, Pencil, Plus, Send, Search, X, Globe, Send as Tg, MessageCircle,
} from "lucide-react";
import { Avatar, Button, CardAction, Dash, EmptyState, ErrorState, KanbanBoard, Pill, SectionTitle, Segmented, Skeleton, Switch, Tabs, Tag, cn, toast, type KanbanColumn, type Tone } from "@all/ui";
import type { ChatMessage, Conversation } from "@all/db";
import { fetchConversation } from "@/lib/read";
import { approveDraft, closeChat, createLeadFromChat, markRead, returnToAi, sendMessage, setDraftMode, simulateClientMessage, takeChat } from "@/lib/actions-1b";
import { useRealtime } from "@/lib/use-realtime";
import { useHotkey } from "@/lib/use-hotkeys";
import { formatPhone, formatTime, relativeTime, formatDateTime } from "@/lib/format";
import { STATUS_TONE } from "../leads/leads-view";

type Detail = NonNullable<Awaited<ReturnType<typeof fetchConversation>>>;
type Tab = "all" | "human" | "mine" | "ai" | "closed";

const STATE_TONE: Record<Conversation["state"], Tone> = { ai: "neutral", draft: "warning", operator: "info", closed: "neutral" };
const CHANNEL_ICON: Record<Conversation["channel"], React.ComponentType<{ className?: string }>> = { widget: Globe, telegram: Tg, whatsapp: MessageCircle, instagram: ImageIcon, facebook: MessageCircle };
const META = ["whatsapp", "instagram", "facebook"];

export function InboxView({ conversations: initial, me, openId: initialOpen, canSimulate }: { conversations: Conversation[]; me: string; openId?: string; canSimulate: boolean }) {
  const t = useTranslations("inbox");
  const [list, setList] = React.useState(initial);
  const [tab, setTab] = React.useState<Tab>("all");
  const [q, setQ] = React.useState("");
  const [openId, setOpenIdState] = React.useState<string | undefined>(initialOpen);
  const [panel, setPanel] = React.useState(true);
  const [fresh, setFresh] = React.useState<Set<string>>(new Set());
  const [mode, setModeState] = React.useState<"list" | "board">("list");
  React.useEffect(() => { try { const m = localStorage.getItem("inbox:mode"); if (m === "board" || m === "list") setModeState(m); } catch { /* ignore */ } }, []);
  const setMode = (m: "list" | "board") => { setModeState(m); try { localStorage.setItem("inbox:mode", m); } catch { /* ignore */ } };

  const setOpenId = React.useCallback((id?: string) => {
    setOpenIdState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("open", id); else url.searchParams.delete("open");
    window.history.replaceState(null, "", url);
  }, []);

  // Новые сообщения приходят через Realtime
  useRealtime((e) => {
    if (e.type !== "message.created" && e.type !== "conversation.updated") return;
    const c = e.conversation;
    setList((l) => [c, ...l.filter((x) => x.id !== c.id)].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
    if (e.type === "message.created" && e.message.author === "client") {
      setFresh((s) => new Set(s).add(c.id));
      setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(c.id); return n; }), 3000);
    }
  });

  const counts: Record<Tab, number> = {
    all: list.filter((c) => c.state !== "closed").length,
    human: list.filter((c) => c.needsHuman && c.state !== "closed").length,
    mine: list.filter((c) => c.assigneeId === me && c.state !== "closed").length,
    ai: list.filter((c) => (c.state === "ai" || c.state === "draft") && !c.needsHuman).length,
    closed: list.filter((c) => c.state === "closed").length,
  };
  const filtered = list.filter((c) => {
    if (tab === "all" && c.state === "closed") return false;
    if (tab === "human" && !(c.needsHuman && c.state !== "closed")) return false;
    if (tab === "mine" && !(c.assigneeId === me && c.state !== "closed")) return false;
    if (tab === "ai" && !((c.state === "ai" || c.state === "draft") && !c.needsHuman)) return false;
    if (tab === "closed" && c.state !== "closed") return false;
    const s = q.trim().toLowerCase();
    return !s || [c.contactName, c.contactPhone, c.lastMessage].some((x) => x?.toLowerCase().includes(s));
  });
  const idx = filtered.findIndex((c) => c.id === openId);
  useHotkey("j", () => { const n = filtered[idx + 1]; if (n) setOpenId(n.id); });
  useHotkey("k", () => { const n = filtered[idx - 1]; if (n) setOpenId(n.id); });
  useHotkey("Escape", () => setOpenId(undefined));

  const modeSwitch = (
    <Segmented label="Вид" value={mode} onChange={setMode} items={[{ value: "list", label: t("viewList"), icon: <List /> }, { value: "board", label: t("viewBoard"), icon: <KanbanSquare /> }]} />
  );

  if (mode === "board") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-3">
          <h1 className="font-display text-base font-semibold tracking-[-0.01em]">{t("title")}</h1>
          <span className="text-xs tabular-nums text-fg-muted">{counts.all}</span>
          <label className="relative ml-2 flex h-7 w-60 items-center max-sm:hidden">
            <Search className="pointer-events-none absolute left-2 size-3.5 text-fg-faint" />
            <input data-page-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="h-7 w-full rounded-full border border-line bg-transparent pl-7 pr-2 text-[13px] placeholder:text-fg-faint focus:border-fg-muted focus:outline-none" />
          </label>
          <div className="ml-auto">{modeSwitch}</div>
        </div>
        <div className="flex min-h-0 flex-1">
          <InboxBoard items={list.filter((c) => { const x = q.trim().toLowerCase(); return !x || [c.contactName, c.contactPhone, c.lastMessage].some((v) => v?.toLowerCase().includes(x)); })}
            me={me} activeId={openId} fresh={fresh} onOpen={(c) => setOpenId(c.id)}
            onChanged={(c) => setList((l) => l.map((x) => (x.id === c.id ? c : x)))} />
          {openId && (
            <div className="flex w-[560px] shrink-0 border-l border-line max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-full max-lg:bg-app">
              <ConversationPane key={openId} id={openId} me={me} panel={false} onTogglePanel={() => undefined} onBack={() => setOpenId(undefined)}
                onChanged={(c) => setList((l) => l.map((x) => (x.id === c.id ? c : x)))} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Список диалогов 300px */}
      <section aria-label={t("title")} className={cn("flex w-[300px] shrink-0 flex-col border-r border-line max-md:w-full", openId && "max-md:hidden")}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <h1 className="font-display text-base font-semibold tracking-[-0.01em]">{t("title")}</h1>
          <span className="text-xs tabular-nums text-fg-muted">{counts.all}</span>
          <div className="ml-auto">{modeSwitch}</div>
        </div>
        <div className="shrink-0 overflow-x-auto border-b border-line px-1.5 py-1">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} items={(["all", "human", "mine", "ai", "closed"] as Tab[]).map((k) => ({ value: k, label: t(`tabs.${k}`), count: counts[k] }))} />
        </div>
        <label className="relative mx-2 my-2 flex h-7 shrink-0 items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-fg-faint" />
          <input data-page-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")}
            className="h-7 w-full rounded-full border border-line bg-transparent pl-7 pr-2 text-[13px] placeholder:text-fg-faint focus:border-fg-muted focus:outline-none" />
        </label>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 && <li><EmptyState title={list.length ? t("emptyTab") : t("empty")} /></li>}
          {filtered.map((c) => {
            const Icon = CHANNEL_ICON[c.channel];
            return (
              <li key={c.id}>
                <button onClick={() => setOpenId(c.id)}
                  className={cn("flex w-full gap-2.5 border-b border-line px-3 py-2 text-left", c.id === openId ? "bg-selected" : "hover:bg-hover", fresh.has(c.id) && "animate-[flash_3s_ease-out]")}>
                  <span className="relative mt-0.5"><Avatar name={c.contactName ?? c.contactPhone} className="size-7 text-[10px]" /><Icon className="absolute -bottom-0.5 -right-1 size-3 rounded-full bg-app text-fg-muted" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("min-w-0 flex-1 truncate text-[13px]", c.unread ? "font-semibold" : "font-medium")}>{c.contactName ?? formatPhone(c.contactPhone)}</span>
                      <span className="shrink-0 text-[11px] text-fg-faint">{relativeTime(c.lastMessageAt)}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("min-w-0 flex-1 truncate text-xs", c.unread ? "text-fg-secondary" : "text-fg-muted")}>{c.lastMessage}</span>
                      {c.needsHuman && c.state !== "closed" && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label={t("needsHuman")} />}
                      {c.unread > 0 && <span className="min-w-4 shrink-0 rounded-full bg-fg px-1 text-center text-[10px] font-semibold tabular-nums text-bg-app">{c.unread}</span>}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1"><Pill tone={STATE_TONE[c.state]} dot={false} className="h-4 px-1.5 text-[10px]">{t(`state.${c.state}`)}</Pill></span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {canSimulate && <SimulateBox conversation={list.find((c) => c.id === openId)} />}
      </section>

      {/* Переписка + панель контакта */}
      {openId ? (
        <ConversationPane key={openId} id={openId} me={me} panel={panel} onTogglePanel={() => setPanel((p) => !p)} onBack={() => setOpenId(undefined)}
          onChanged={(c) => setList((l) => l.map((x) => (x.id === c.id ? c : x)))} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-fg-muted max-md:hidden">{t("select")}</div>
      )}
    </div>
  );
}

function ConversationPane({ id, me, panel, onTogglePanel, onBack, onChanged }: { id: string; me: string; panel: boolean; onTogglePanel: () => void; onBack: () => void; onChanged: (c: Conversation) => void }) {
  const t = useTranslations("inbox");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const [d, setD] = React.useState<Detail | null | undefined>(undefined);
  const [error, setError] = React.useState(false);
  const load = React.useCallback(() => { setError(false); fetchConversation(id).then(setD).catch(() => setError(true)); }, [id]);
  React.useEffect(() => { load(); void markRead(id); }, [load, id]);
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [d?.messages.length]);

  useRealtime((e) => {
    if ((e.type === "message.created" || e.type === "conversation.updated") && e.conversation.id === id) {
      setD((cur) => {
        if (!cur) return cur;
        let msgs = cur.messages;
        if (e.type === "message.created") {
          msgs = e.message.status === "draft" ? [...msgs.filter((m) => m.status !== "draft"), e.message] : [...msgs.filter((m) => m.id !== e.message.id), e.message];
        }
        return { ...cur, conversation: e.conversation, messages: msgs };
      });
      if (e.type === "message.created" && e.message.author === "client") void markRead(id);
    }
  });

  if (error) return <div className="flex-1"><ErrorState title={tc("errorTitle")} retry={load} retryLabel={tc("retry")} /></div>;
  if (d === undefined) return <div className="flex flex-1 flex-col gap-3 p-4"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-24 w-2/3" /><Skeleton className="ml-auto h-16 w-1/2" /></div>;
  if (d === null) return <div className="flex-1"><ErrorState title={tc("notFound")} /></div>;
  const c = d.conversation;
  const apply = (r: { ok: boolean; error?: string; data?: unknown }) => {
    if (!r.ok) { toast.error(r.error ?? ""); return false; }
    if (r.data && typeof r.data === "object" && "state" in r.data) { const conv = r.data as Conversation; setD({ ...d, conversation: conv }); onChanged(conv); }
    load();
    return true;
  };
  const windowLeft = META.includes(c.channel) ? (c.windowExpiresAt ? new Date(c.windowExpiresAt).getTime() - Date.now() : -1) : null;
  const windowClosed = windowLeft != null && windowLeft <= 0;
  const draft = d.messages.find((m) => m.status === "draft");
  const Icon = CHANNEL_ICON[c.channel];

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Шапка переписки */}
        <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
          <button onClick={onBack} aria-label={tc("back")} className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover md:hidden"><ChevronLeft className="size-4" /></button>
          <Icon className="size-4 text-fg-muted" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{c.contactName ?? formatPhone(c.contactPhone)}</p>
            <p className="text-[11px] text-fg-muted">{t(`channel.${c.channel}`)} · <span className={c.state === "operator" ? "text-info" : ""}>{t(`state.${c.state}`)}</span></p>
          </div>
          {windowLeft != null && (
            <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] tabular-nums", windowClosed ? "bg-danger-bg text-danger" : windowLeft < 3 * 3600_000 ? "bg-warning-bg text-warning" : "bg-neutral text-fg-muted")}>
              {windowClosed ? <Lock className="size-3" /> : <Clock className="size-3" />}{windowClosed ? "окно закрыто" : t("window", { time: `${Math.floor(windowLeft / 3600_000)} ч ${Math.floor((windowLeft % 3600_000) / 60_000)} мин` })}
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {c.state !== "closed" && c.state !== "operator" && (
              <label className="flex items-center gap-1.5 text-xs text-fg-muted max-lg:hidden">{t("draftMode")}<Switch label={t("draftMode")} checked={c.state === "draft"} onChange={async (v) => apply(await setDraftMode(c.id, v))} /></label>
            )}
            {c.state === "operator" && c.assigneeId === me
              ? <Button size="sm" icon={<Bot />} onClick={async () => apply(await returnToAi(c.id))}>{t("returnAi")}</Button>
              : c.state !== "closed" && <Button size="sm" variant="primary" icon={<Hand />} onClick={async () => { if (apply(await takeChat(c.id))) toast(t("taken")); }}>{t("take")}</Button>}
            <Button size="sm" icon={<Plus />} onClick={async () => { const r = await createLeadFromChat(c.id, c.lastMessage.slice(0, 80) || "Заявка из чата"); if (r.ok) toast.success(t("leadCreated", { number: r.data!.number })); else toast.error(r.error); load(); }}>{t("createLead")}</Button>
            {c.state !== "closed" && <Button size="sm" variant="ghost" icon={<X />} onClick={async () => apply(await closeChat(c.id))}>{t("close")}</Button>}
            <button onClick={onTogglePanel} aria-label={t("panel")} className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover max-lg:hidden">{panel ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}</button>
          </div>
        </header>
        {c.state === "operator" && <div className="shrink-0 border-b border-line bg-info-bg px-3 py-1 text-[11px] text-info">{c.assigneeId === me ? t("taken") : t("aiSilent")}</div>}

        {/* Пузыри */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <ol className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {d.messages.filter((m) => m.status !== "draft").map((m, i, arr) => <Bubble key={m.id} m={m} showTime={i === 0 || new Date(m.createdAt).getTime() - new Date(arr[i - 1]!.createdAt).getTime() > 10 * 60_000} />)}
          </ol>
          <div ref={end} />
        </div>

        {/* Черновик AI */}
        {draft && c.state === "draft" && <DraftBox c={c} draft={draft} disabled={windowClosed} onDone={load} />}
        <Composer c={c} templates={d.templates} quick={d.quickReplies} windowClosed={windowClosed} onSent={load} />
      </section>

      {/* Правая панель 320px */}
      {panel && (
        <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-line max-lg:hidden">
          <section className="border-b border-line px-3 py-3">
            <SectionTitle aside={c.contactId && <Link href={`/app/contacts?open=${c.contactId}`} className="text-xs text-fg-muted hover:text-fg">{tc("open")}</Link>}>{t("contact")}</SectionTitle>
            <p className="text-[13px] font-medium">{c.contactName ?? "—"}</p>
            <p className="text-xs tabular-nums text-fg-muted">{formatPhone(c.contactPhone)}</p>
            {d.contact?.notes && <p className="mt-1.5 text-xs text-fg-secondary">{d.contact.notes}</p>}
          </section>
          <section className="border-b border-line px-3 py-3">
            <SectionTitle>{t("channels")}</SectionTitle>
            <div className="flex flex-wrap gap-1">{(d.contact?.channels ?? [c.channel]).map((ch) => <Tag key={ch}>{ch === "phone" ? "Телефон" : t.has(`channel.${ch}`) ? t(`channel.${ch}` as "channel.widget") : ch}</Tag>)}</div>
          </section>
          <section className="border-b border-line px-3 py-3">
            <SectionTitle>{t("leads")}</SectionTitle>
            {d.leads.length === 0 ? <Dash /> : <ul className="flex flex-col gap-1">{d.leads.map((l) => (
              <li key={l.id}><Link href={`/app/leads?open=${l.id}`} className="flex items-center gap-2 text-[13px] hover:underline"><span className="text-xs tabular-nums text-fg-faint">#{l.number}</span><span className="min-w-0 flex-1 truncate">{l.title}</span><Pill tone={STATUS_TONE[l.status]} dot={false} className="h-4 px-1.5 text-[10px]">{te(`leadStatus.${l.status}`)}</Pill></Link></li>
            ))}</ul>}
          </section>
          <section className="px-3 py-3">
            <SectionTitle>{t("history")}</SectionTitle>
            <ul className="flex flex-col gap-1.5">
              {d.otherChats.map((o) => <li key={o.id} className="text-xs"><span className="text-fg-faint">{relativeTime(o.lastMessageAt)}</span> · {t(`channel.${o.channel}`)}: <span className="text-fg-secondary">{o.lastMessage}</span></li>)}
              {d.timeline.map((i) => <li key={i.id}><Link href={i.href ?? "#"} className="block text-xs hover:underline"><span className="text-fg-faint">{formatDateTime(i.at)}</span> · <span className="text-fg-secondary">{i.title}</span></Link></li>)}
              {!d.timeline.length && !d.otherChats.length && <Dash />}
            </ul>
          </section>
        </aside>
      )}
    </>
  );
}

function Bubble({ m, showTime }: { m: ChatMessage; showTime: boolean }) {
  const t = useTranslations("inbox");
  if (m.author === "system") {
    return <li className="my-1 text-center text-[11px] text-fg-faint">{m.body} · {formatTime(m.createdAt)}</li>;
  }
  const mine = m.direction === "out";
  return (
    <li className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      {showTime && <span className="mb-0.5 text-[10px] text-fg-faint">{formatDateTime(m.createdAt)}</span>}
      <span className="mb-0.5 text-[10px] text-fg-faint">{m.author === "ai" ? t("ai") : m.author === "operator" ? t("you") : ""}</span>
      <div className={cn("max-w-[75%] rounded-[16px] px-3 py-1.5 text-[13px] leading-5",
        m.author === "client" && "rounded-bl-[6px] bg-subtle ring-1 ring-line",
        m.author === "ai" && "rounded-br-[6px] bg-active text-fg",
        m.author === "operator" && "rounded-br-[6px] bg-accent text-accent-fg")}>
        {m.attachments.map((a, i) => a.kind === "voice" ? (
          <div key={i} className="flex flex-col gap-1">
            <span className="flex items-center gap-2"><Mic className="size-3.5" /><span className="flex h-4 flex-1 items-center gap-px">{Array.from({ length: 24 }, (_, j) => <span key={j} className="w-0.5 rounded-full bg-current opacity-50" style={{ height: `${30 + ((j * 37) % 70)}%` }} />)}</span><span className="text-[11px] tabular-nums">0:{String(a.durationS ?? 0).padStart(2, "0")}</span></span>
            {m.transcript && <span className="text-xs italic opacity-80">{t("transcript")}: {m.transcript}</span>}
          </div>
        ) : (
          <span key={i} className="mb-1 flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 text-xs">{a.kind === "image" ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}{a.name}</span>
        ))}
        {m.body && <span className="whitespace-pre-wrap">{m.body}</span>}
      </div>
      {mine && <span className="mt-0.5 flex items-center gap-0.5 text-[10px] text-fg-faint">{formatTime(m.createdAt)}{m.status === "delivered" ? <CheckCheck className="size-3" /> : <Check className="size-3" />}</span>}
    </li>
  );
}

/** Черновик AI с кнопками «Отправить» и «Изменить» */
function DraftBox({ c, draft, disabled, onDone }: { c: Conversation; draft: ChatMessage; disabled: boolean; onDone: () => void }) {
  const t = useTranslations("inbox");
  const [edit, setEdit] = React.useState(false);
  const [text, setText] = React.useState(draft.body ?? "");
  React.useEffect(() => setText(draft.body ?? ""), [draft.body]);
  const send = async (body?: string) => { const r = await approveDraft(c.id, draft.id, body); if (!r.ok) toast.error(r.error); onDone(); };
  return (
    <div className="mx-3 mb-2 shrink-0 rounded-[12px] border border-warning/40 bg-warning-bg/50 p-2.5">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-warning"><Bot className="size-3.5" />{t("draft")} · {t("draftHint")}</p>
      {edit ? <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-[8px] border border-line bg-bg px-2 py-1 text-[13px] focus:outline-none" />
        : <p className="text-[13px] leading-5">{draft.body}</p>}
      <div className="mt-2 flex gap-1.5">
        <Button size="sm" variant="primary" icon={<Send />} disabled={disabled} onClick={() => send(edit ? text : undefined)}>{t("draftSend")}</Button>
        {!edit && <Button size="sm" icon={<Pencil />} onClick={() => setEdit(true)}>{t("draftEdit")}</Button>}
      </div>
    </div>
  );
}

/** Поле ответа: текст, вложения, быстрые ответы по «/», шаблоны вне окна */
function Composer({ c, templates, quick, windowClosed, onSent }: { c: Conversation; templates: { key: string; text: string }[]; quick: { key: string; text: string }[]; windowClosed: boolean; onSent: () => void }) {
  const t = useTranslations("inbox");
  const [text, setText] = React.useState("");
  const [files, setFiles] = React.useState<{ kind: "image" | "file"; name: string }[]>([]);
  const [pending, start] = React.useTransition();
  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const suggestions = slash != null ? quick.filter((x) => x.key.startsWith(slash)) : [];
  const fill = (tpl: string) => tpl.replace("{{name}}", c.contactName?.split(" ")[0] ?? "");
  const send = (template?: string, body = text) => start(async () => {
    const r = await sendMessage(c.id, { body, template, attachments: files });
    if (!r.ok) { toast.error(r.error); return; }
    setText(""); setFiles([]); onSent();
  });
  if (c.state === "closed") return <div className="shrink-0 border-t border-line px-3 py-2.5 text-center text-xs text-fg-muted">Диалог закрыт. Новое сообщение клиента откроет новый диалог.</div>;
  if (windowClosed) {
    return (
      <div className="shrink-0 border-t border-line p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs text-danger"><Lock className="size-3.5" />{t("windowClosed")}</p>
        <div className="flex flex-col gap-1.5">
          {templates.map((tpl) => (
            <button key={tpl.key} disabled={pending} onClick={() => send(tpl.key, fill(tpl.text))} className="rounded-[10px] border border-line px-3 py-2 text-left text-[13px] hover:bg-hover">
              <span className="block text-[11px] text-fg-faint">{t("templates")} · {tpl.key}</span>{fill(tpl.text)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="relative shrink-0 border-t border-line p-2">
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-2 mb-1 w-80 rounded-[10px] bg-elevated p-1 shadow-[var(--shadow-pop)]">
          <li className="px-2 py-1 text-[11px] text-fg-faint">{t("quick")}</li>
          {suggestions.map((s) => <li key={s.key}><button onClick={() => setText(s.text)} className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-hover"><span className="font-mono text-fg-muted">/{s.key}</span> {s.text}</button></li>)}
        </ul>
      )}
      {files.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1">{files.map((f) => <Tag key={f.name} onRemove={() => setFiles(files.filter((x) => x !== f))}>{f.name}</Tag>)}</div>}
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(); }} className="flex items-end gap-1.5">
        <label className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:bg-hover" aria-label={t("attach")}>
          <Paperclip className="size-4" />
          <input type="file" multiple className="sr-only" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? []).map((f) => ({ kind: f.type.startsWith("image/") ? "image" as const : "file" as const, name: f.name }))])} />
        </label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={t("placeholder")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim() && suggestions.length === 0) { e.preventDefault(); send(); } }}
          className="max-h-32 min-h-8 flex-1 resize-none rounded-[16px] border border-line bg-bg px-3 py-1.5 text-[13px] leading-5 placeholder:text-fg-faint focus:border-fg-muted focus:outline-none" />
        <Button type="submit" size="icon" variant="primary" aria-label={t("send")} loading={pending} disabled={!text.trim()}>{!pending && <Send />}</Button>
      </form>
    </div>
  );
}

/** Тест канала: сообщение «от клиента», чтобы проверить ответ AI и черновики */
function SimulateBox({ conversation }: { conversation?: Conversation }) {
  const t = useTranslations("inbox");
  const [text, setText] = React.useState("");
  const [channel, setChannel] = React.useState<"telegram" | "widget" | "whatsapp">("telegram");
  // Сообщение уходит в открытый диалог (если он не закрыт), иначе — новый диалог в выбранном канале
  const target = conversation && conversation.state !== "closed" && conversation.channel !== "instagram" && conversation.channel !== "facebook" ? conversation : undefined;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      const r = await simulateClientMessage(target ? { conversationId: target.id, channel: target.channel as "telegram", contactId: target.contactId, body: text } : { channel, body: text });
      if (!r.ok) toast.error(r.error);
      setText("");
    }}
      className="flex shrink-0 flex-col gap-1.5 border-t border-line p-2">
      <span className="text-[11px] text-fg-faint">{t("simulate")}</span>
      <div className="flex gap-1">
        <select value={target ? target.channel : channel} disabled={!!target} onChange={(e) => setChannel(e.target.value as typeof channel)} className="h-7 rounded-full border border-line bg-bg px-2 text-xs disabled:opacity-60" aria-label="Канал">
          <option value="telegram">Telegram</option><option value="widget">Сайт</option><option value="whatsapp">WhatsApp</option>
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("simulatePh")} className="h-7 min-w-0 flex-1 rounded-full border border-line bg-bg px-2.5 text-xs focus:border-fg-muted focus:outline-none" />
      </div>
    </form>
  );
}

type BoardCol = "human" | "ai" | "draft" | "operator" | "closed";
const boardColumn = (c: Conversation): BoardCol =>
  c.state === "closed" ? "closed" : c.state === "operator" ? "operator" : c.needsHuman ? "human" : c.state === "draft" ? "draft" : "ai";

/** Доска чатов: перетаскивание = действие («Взять чат», «Вернуть AI», «Черновик», «Закрыть») */
function InboxBoard({ items, me, activeId, fresh, onOpen, onChanged }: { items: Conversation[]; me: string; activeId?: string; fresh: Set<string>; onOpen: (c: Conversation) => void; onChanged: (c: Conversation) => void }) {
  const t = useTranslations("inbox");
  const columns: KanbanColumn<BoardCol>[] = [
    { key: "human", label: t("tabs.human"), tone: "warning", hint: t("board.human"), dropDisabled: t("board.humanDrop") },
    { key: "ai", label: t("tabs.ai"), tone: "neutral", hint: t("board.ai") },
    { key: "draft", label: t("state.draft"), tone: "warning", hint: t("board.draft") },
    { key: "operator", label: t("state.operator"), tone: "info", hint: t("board.operator") },
    { key: "closed", label: t("tabs.closed"), tone: "neutral", collapsed: true },
  ];
  const run = async (p: Promise<{ ok: boolean; error?: string; data?: unknown }>, ok?: string) => {
    const r = await p;
    if (!r.ok) { toast.error(r.error ?? ""); return; }
    if (r.data && typeof r.data === "object" && "state" in r.data) onChanged(r.data as Conversation);
    if (ok) toast(ok);
  };
  const move = async (c: Conversation, to: BoardCol) => {
    if (to === "operator") return run(takeChat(c.id), t("taken"));
    if (to === "closed") return run(closeChat(c.id));
    if (c.state === "operator") await run(returnToAi(c.id));
    if (to === "draft") return run(setDraftMode(c.id, true));
    if (to === "ai") return run(setDraftMode(c.id, false));
  };
  const sorted = [...items].sort((a, b) => b.unread - a.unread || b.lastMessageAt.localeCompare(a.lastMessageAt));
  return (
    <KanbanBoard columns={columns} items={sorted} getId={(c) => c.id} getColumn={boardColumn} onMove={move} onOpen={onOpen} activeId={activeId}
      storageKey="inbox:board" highlightIds={fresh} isUrgent={(c) => c.needsHuman && c.state !== "closed"}
      renderCard={(c) => {
        const Icon = CHANNEL_ICON[c.channel];
        const closedWindow = META.includes(c.channel) && (!c.windowExpiresAt || new Date(c.windowExpiresAt).getTime() < Date.now());
        return (
          <>
            <div className="flex items-center gap-1.5">
              <Icon className="size-3.5 shrink-0 text-fg-muted" />
              <span className={cn("min-w-0 flex-1 truncate text-[13px]", c.unread ? "font-semibold" : "font-medium")}>{c.contactName ?? formatPhone(c.contactPhone)}</span>
              <span className="shrink-0 text-[11px] text-fg-faint">{relativeTime(c.lastMessageAt)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-fg-secondary">{c.lastMessage}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {c.state !== "operator" && c.state !== "closed" && <CardAction primary onClick={() => move(c, "operator")}><Hand />{t("take")}</CardAction>}
              {c.state === "operator" && c.assigneeId === me && <CardAction onClick={() => move(c, "ai")}><Bot />{t("returnAi")}</CardAction>}
              {c.state !== "closed" && <CardAction onClick={() => move(c, "closed")}><X />{t("close")}</CardAction>}
              <span className="ml-auto flex items-center gap-1">
                {closedWindow && <Lock className="size-3 text-danger" aria-label={t("windowClosed")} />}
                {c.unread > 0 && <span className="min-w-4 rounded-full bg-fg px-1 text-center text-[10px] font-semibold tabular-nums text-bg-app">{c.unread}</span>}
                {c.assigneeId && <Avatar name={c.assigneeId === me ? t("you") : "Оператор"} />}
              </span>
            </div>
          </>
        );
      }} />
  );
}
