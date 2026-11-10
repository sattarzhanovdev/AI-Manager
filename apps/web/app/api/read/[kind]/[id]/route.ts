import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { isSupabase } from "@/lib/env";
import { getCall, getLead, getContact } from "@/lib/data/repo";
import { getIntegrationLogs, getConversation } from "@/lib/data/repo";

export const dynamic = "force-dynamic";

/** Чтение детали для split view (GET, без перезагрузки страницы). Права — RLS (supabase) или те же правила в mock. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { kind, id } = await params;
  // В режиме supabase идентификаторы — uuid; иное сразу 404 (без запроса в базу)
  if (isSupabase && !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const data =
      kind === "call" ? await getCall(s, id) :
      kind === "lead" ? await getLead(s, id) :
      kind === "contact" && s.member.role !== "accountant" ? await getContact(s, id) :
      !isSupabase && kind === "conversation" && s.member.role !== "accountant" ? await getConversation(s, id) :
      !isSupabase && kind === "integration-log" && s.member.role === "owner" ? await getIntegrationLogs(s, id) :
      undefined;
    if (data === undefined || data === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    console.error(`[read] ${kind} failed`, e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
