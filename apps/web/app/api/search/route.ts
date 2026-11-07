import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listCalls, listContacts, listLeads } from "@/lib/data/repo";

/** Поиск для ⌘K: звонки по номеру, контакты по имени и телефону, заявки по номеру */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ calls: [], contacts: [], leads: [] });
  const digits = q.replace(/\D/g, "");
  const [allContacts, allCalls, allLeads] = await Promise.all([listContacts(s), listCalls(s), listLeads(s)]);
  const contacts = allContacts.filter((c) => c.name?.toLowerCase().includes(q) || (digits.length >= 3 && c.phone?.includes(digits))).slice(0, 5)
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
  const calls = digits.length >= 3 ? allCalls.filter((c) => c.caller.includes(digits)).slice(0, 5).map((c) => ({ id: c.id, caller: c.caller, name: c.contactName, at: c.startedAt })) : [];
  const leads = allLeads.filter((l) => String(l.number).includes(digits || "§") || l.title.toLowerCase().includes(q)).slice(0, 5).map((l) => ({ id: l.id, number: l.number, title: l.title }));
  return NextResponse.json({ calls, contacts, leads });
}
