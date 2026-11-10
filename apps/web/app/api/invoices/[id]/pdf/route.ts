import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getInvoices, getCompany } from "@/lib/data/repo";
import { formatMoney } from "@/lib/format";
import { isSupabase } from "@/lib/env";

/** Счёт для печати (HTML → «Сохранить как PDF»). Генерация настоящего PDF — воркер биллинга. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isSupabase) return new Response("not found", { status: 404 });
  const s = await getSession();
  if (!s || !can(s.member.role, "view_billing")) return new Response("forbidden", { status: 403 });
  const { id } = await params;
  const inv = (await getInvoices(s)).find((i) => i.id === id);
  if (!inv) return new Response("not found", { status: 404 });
  const c = await getCompany(s);
  const escape = (v: string) => v.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  const html = `<!doctype html><meta charset="utf-8"><title>Счёт ${escape(inv.number)}</title>
<style>body{font:14px/1.5 system-ui;margin:48px;color:#161616}h1{font-weight:500;letter-spacing:-.02em}table{border-collapse:collapse;width:100%;margin-top:24px}td,th{border-bottom:1px solid #e5e5e5;padding:8px;text-align:left}td:last-child{text-align:right}</style>
<h1>Счёт № ${escape(inv.number)}</h1><p>Плательщик: ${escape(c.name)}<br>Период: ${inv.periodStart} — ${inv.periodEnd}</p>
<table><tr><th>Услуга</th><th>Сумма</th></tr><tr><td>Подписка ALL-менеджер</td><td>${formatMoney(inv.amountMinor, inv.currency)}</td></tr></table>
<p style="margin-top:24px;color:#686868">ALL-менеджер</p>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "no-store" } });
}
