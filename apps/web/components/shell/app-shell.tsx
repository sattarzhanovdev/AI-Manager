"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3, Bell, BookOpen, Bot, CalendarDays, ChevronsLeft, ChevronsRight, CreditCard, Inbox, LayoutDashboard,
  MessagesSquare, MoreHorizontal, Phone, Plug, Search, Settings, UserCog, Users, Moon, Sun, LogOut, Keyboard, Languages, FlaskConical,
} from "lucide-react";
import { Avatar, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip, cn, toast } from "@all/ui";
import type { AiMode, AppNotification, Member } from "@all/db";
import { useHotkey } from "@/lib/use-hotkeys";
import { useRealtime } from "@/lib/use-realtime";
import { devLoginAs, logout, endSupport, setLocale } from "@/lib/actions";
import { AiSwitch } from "./ai-switch";
import { CommandPalette } from "./command-palette";
import { NotificationsPanel } from "./notifications-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { Banners, type BannerData } from "./banners";

export interface ShellProps {
  company: { name: string; branches: { id: string; name: string }[] };
  member: Pick<Member, "name" | "role" | "userId">;
  canToggleAi: boolean;
  aiMode: AiMode;
  minutesLeft: number;
  planName: string;
  counts: { leads: number; unanswered: number; chats: number };
  notifications: AppNotification[];
  banners: BannerData;
  mock: boolean;
  /** Hackathon MVP на Supabase: без тарифа и минут в навигации */
  mvp: boolean;
  /** Метка «Demo Environment» */
  demoEnv: boolean;
  locale: string;
  demoUsers: { userId: string; name: string; role: string }[];
  hidden: string[];
  children: React.ReactNode;
}

type NavItem = { href: string; key: string; icon: React.ComponentType<{ className?: string }>; count?: number; phase1b?: boolean };

export function AppShell(props: ShellProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState(props.notifications);
  const [newLeads, setNewLeads] = React.useState(props.counts.leads);
  const gPressed = React.useRef<number>(0);

  React.useEffect(() => setNotifications(props.notifications), [props.notifications]);
  React.useEffect(() => setNewLeads(props.counts.leads), [props.counts.leads]);
  React.useEffect(() => {
    try { setCollapsed(localStorage.getItem("nav:collapsed") === "1"); } catch { /* ignore */ }
  }, []);
  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem("nav:collapsed", c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  useRealtime((e) => {
    if (e.type === "notification") {
      setNotifications((n) => [e.notification, ...n]);
      toast(e.notification.title, { description: e.notification.body });
    }
    if (e.type === "lead.created") setNewLeads((n) => n + 1);
    if (e.type === "company.ai_mode") router.refresh();
  });

  // ⌘K, G+буква, ?
  useHotkey("k", (e) => { e.preventDefault(); setPaletteOpen((o) => !o); }, { meta: true, allowInInput: true });
  useHotkey("?", () => setHelpOpen(true));
  useHotkey("/", (e) => {
    const el = document.querySelector<HTMLInputElement>("[data-page-search]");
    if (el) { e.preventDefault(); el.focus(); }
  });
  React.useEffect(() => {
    const map: Record<string, string> = { o: "/app", z: "/app/calls", l: "/app/leads", i: "/app/inbox", a: "/app/knowledge" };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "g") { gPressed.current = Date.now(); return; }
      if (Date.now() - gPressed.current < 1200 && map[e.key]) {
        e.preventDefault();
        gPressed.current = 0;
        router.push(map[e.key]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, t]);

  const nav: NavItem[] = [
    { href: "/app", key: "overview", icon: LayoutDashboard },
    { href: "/app/calls", key: "calls", icon: Phone },
    { href: "/app/leads", key: "leads", icon: Inbox, count: newLeads },
    { href: "/app/inbox", key: "inbox", icon: MessagesSquare, count: props.counts.chats },
    { href: "/app/calendar", key: "calendar", icon: CalendarDays },
    { href: "/app/contacts", key: "contacts", icon: Users },
    { href: "/app/knowledge", key: "knowledge", icon: BookOpen, count: props.counts.unanswered },
    { href: "/app/assistant", key: "assistant", icon: Bot },
    { href: "/app/analytics", key: "analytics", icon: BarChart3 },
    { href: "/app/integrations", key: "integrations", icon: Plug },
    { href: "/app/team", key: "team", icon: UserCog },
    { href: "/app/billing", key: "billing", icon: CreditCard },
    { href: "/app/settings", key: "settings", icon: Settings },
  ].filter((n) => !props.hidden.includes(n.key));

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const current = nav.find((n) => isActive(n.href));
  const unread = notifications.filter((n) => !n.readAt).length;

  const setTheme = (theme: "dark" | "light") => {
    document.documentElement.dataset.theme = theme;
    document.cookie = `theme=${theme}; path=/; max-age=31536000`;
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-app">
      {/* Левая навигация 224 / 56 px */}
      <nav aria-label="Основная навигация"
        className={cn("hidden shrink-0 flex-col border-r border-line bg-app transition-[width] md:flex", collapsed ? "w-[var(--nav-w-collapsed)]" : "w-[var(--nav-w)]")}>
        <div className={cn("flex h-11 items-center gap-2 border-b border-line", collapsed ? "justify-center px-2" : "px-3")}>
          <Menu>
            <MenuTrigger className={cn("flex min-w-0 items-center gap-2 rounded-md text-left hover:bg-hover", collapsed ? "p-1" : "-mx-1 flex-1 px-1 py-1")}>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-accent font-display text-[11px] font-semibold text-accent-fg">A</span>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-4">{props.company.name}</span>
                  <span className="block truncate text-[11px] leading-4 text-fg-muted">{t("nav.allBranches")}</span>
                </span>
              )}
            </MenuTrigger>
            <MenuContent align="start">
              <MenuLabel>{props.company.name}</MenuLabel>
              <MenuItem>{t("nav.allBranches")}</MenuItem>
              {props.company.branches.map((b) => <MenuItem key={b.id}>{b.name}</MenuItem>)}
            </MenuContent>
          </Menu>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-2">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            const label = t(`nav.${item.key}`);
            const content = (
              <Link href={item.phase1b ? "#" : item.href} aria-current={active ? "page" : undefined}
                onClick={(e) => { if (item.phase1b) { e.preventDefault(); toast(t("common.comingPhase")); } }}
                className={cn("flex h-8 items-center gap-2.5 rounded-[8px] text-[13px] transition-colors",
                  collapsed ? "justify-center" : "px-2",
                  active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                  item.phase1b && "opacity-45")}>
                <Icon className="size-[18px] shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{label}</span>}
                {!collapsed && item.count ? <span className="rounded-full bg-active px-1.5 text-[11px] tabular-nums text-fg-secondary">{item.count}</span> : null}
                {collapsed && item.count ? <span className="absolute ml-5 -mt-4 size-1.5 rounded-full bg-fg" /> : null}
              </Link>
            );
            return <li key={item.key} className="relative">{collapsed ? <Tooltip content={label} side="right">{content}</Tooltip> : content}</li>;
          })}
        </ul>
        <div className="border-t border-line p-2">
          {!collapsed && !props.mvp && (
            <Link href="/app/billing" className="mb-1 block rounded-[8px] px-2 py-1.5 hover:bg-hover">
              <span className="block text-[11px] text-fg-muted">{t("nav.plan", { name: props.planName })}</span>
              <span className={cn("block text-xs tabular-nums", props.minutesLeft < 150 ? "text-warning" : "text-fg-secondary")}>{t("nav.minutesLeft", { count: props.minutesLeft })}</span>
            </Link>
          )}
          <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
            <Menu>
              <MenuTrigger className={cn("flex min-w-0 items-center gap-2 rounded-[8px] p-1.5 hover:bg-hover", !collapsed && "flex-1")}>
                <Avatar name={props.member.name} className="size-6 text-[10px]" />
                {!collapsed && (
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-xs leading-4">{props.member.name}</span>
                    <span className="block text-[11px] leading-4 text-fg-muted">{t(`enums.role.${props.member.role}`)}</span>
                  </span>
                )}
              </MenuTrigger>
              <MenuContent align="start">
                <MenuLabel>{t("nav.theme")}</MenuLabel>
                <MenuItem icon={<Moon />} onSelect={() => setTheme("dark")}>{t("nav.themeDark")}</MenuItem>
                <MenuItem icon={<Sun />} onSelect={() => setTheme("light")}>{t("nav.themeLight")}</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Keyboard />} shortcut="?" onSelect={() => setHelpOpen(true)}>{t("nav.shortcuts")}</MenuItem>
                <MenuSeparator />
                <MenuLabel>{t("mvp.language")}</MenuLabel>
                {/* Английская локализация не завершена — выбор временно скрыт */}
                {([["ru", "Русский"], ["ky", "Кыргызча"]] as const).map(([code, label]) => (
                  <MenuItem key={code} icon={<Languages />} onSelect={async () => { await setLocale(code); router.refresh(); }}>
                    {label}{props.locale === code ? " ✓" : ""}
                  </MenuItem>
                ))}
                {props.mock && (
                  <>
                    <MenuSeparator />
                    <MenuLabel>{t("nav.devRole")}</MenuLabel>
                    {props.demoUsers.map((u) => (
                      <MenuItem key={u.userId} onSelect={async () => { await devLoginAs(u.userId); router.refresh(); }}>
                        {u.name} · {t(`enums.role.${u.role}`)}
                      </MenuItem>
                    ))}
                  </>
                )}
                <MenuSeparator />
                <MenuItem icon={<LogOut />} onSelect={async () => { await logout(); router.push("/login"); router.refresh(); }}>{t("nav.logout")}</MenuItem>
              </MenuContent>
            </Menu>
            <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
              className="inline-flex size-7 items-center justify-center rounded-full text-fg-faint hover:bg-hover hover:text-fg">
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </button>
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Верхняя полоса 44 px */}
        <header className="relative flex h-11 shrink-0 items-center gap-2 border-b border-line bg-app px-3">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="hidden truncate text-fg-muted sm:inline">{props.company.name}</span>
            <span className="hidden text-fg-faint sm:inline">/</span>
            <span className="truncate font-medium">{current ? t(`nav.${current.key}`) : ""}</span>
          </div>
          {props.demoEnv && (
            <Tooltip content={t("mvp.demoEnvHint")}>
              <span data-testid="demo-env" className="ml-2 inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-line-strong px-2 text-[11px] text-fg-muted">
                <FlaskConical className="size-3" aria-hidden />{t("mvp.demoEnv")}
              </span>
            </Tooltip>
          )}
          <button type="button" onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-8 w-64 items-center gap-2 rounded-full border border-line px-3 text-[13px] text-fg-faint hover:border-line-strong max-lg:w-auto">
            <Search className="size-3.5" />
            <span className="flex-1 text-left max-lg:hidden">{t("common.search")}</span>
            <span className="flex gap-0.5 max-lg:hidden"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </button>
          <AiSwitch mode={props.aiMode} disabled={!props.canToggleAi} />
          <button type="button" onClick={() => setNotifOpen(true)} aria-label={t("notifications.title")}
            className="relative inline-flex size-8 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg">
            <Bell className="size-[18px]" />
            {unread > 0 && <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-fg px-1 text-[9px] font-semibold tabular-nums text-bg-app">{unread}</span>}
          </button>
          {props.aiMode !== "off" && <div className="glow-line pointer-events-none absolute inset-x-0 -bottom-px opacity-70" aria-hidden />}
        </header>
        {props.banners.support && (
          <div className="flex h-8 shrink-0 items-center justify-center gap-3 bg-warning-bg text-xs text-warning">
            {t("banners.support")}
            <button className="underline" onClick={async () => { await endSupport(); router.refresh(); }}>{t("banners.endSupport")}</button>
          </div>
        )}
        <Banners data={props.banners} aiMode={props.aiMode} canToggleAi={props.canToggleAi} />
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-app pb-14 md:pb-0">{props.children}</main>
      </div>

      {/* Мобильная нижняя навигация */}
      <nav aria-label="Нижняя навигация" className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-line bg-elevated md:hidden">
        {[nav.find((n) => n.key === "overview"), nav.find((n) => n.key === "leads"), nav.find((n) => n.key === "contacts"), nav.find((n) => n.key === "inbox") ?? nav.find((n) => n.key === "assistant")].filter(Boolean).map((item) => {
          const Icon = item!.icon;
          return (
            <Link key={item!.key} href={item!.phase1b ? "#" : item!.href} className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px]", isActive(item!.href) ? "text-fg" : "text-fg-muted", item!.phase1b && "opacity-45")}>
              <Icon className="size-5" />{t(`nav.${item!.key}`)}
            </Link>
          );
        })}
        <Menu>
          <MenuTrigger className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-fg-muted">
            <MoreHorizontal className="size-5" />{t("nav.more")}
          </MenuTrigger>
          <MenuContent>
            {nav.filter((n) => !["overview", "leads", "contacts", props.hidden.includes("inbox") ? "assistant" : "inbox", "calendar"].includes(n.key)).map((n) => (
              <MenuItem key={n.key} onSelect={() => router.push(n.href)}>{t(`nav.${n.key}`)}</MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} canToggleAi={props.canToggleAi} />
      <NotificationsPanel open={notifOpen} onOpenChange={setNotifOpen} items={notifications} onRead={(ids) => setNotifications((list) => list.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)))} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
