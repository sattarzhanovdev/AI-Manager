import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCall, getLead, getContact, getIntegrationLogs, getConversation } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

/** Чтение детали для split view (GET, без перезагрузки страницы). Права — как у RLS. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { kind, id } = await params;
  const data =
    kind === "call" ? getCall(s, id) :
    kind === "lead" ? getLead(s, id) :
    kind === "conversation" && s.member.role !== "accountant" ? getConversation(s, id) :
    kind === "contact" && s.member.role !== "accountant" ? getContact(id) :
    kind === "integration-log" && s.member.role === "owner" ? getIntegrationLogs(id) :
    undefined;
  if (data === undefined) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data);
}
