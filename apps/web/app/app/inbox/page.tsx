import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { listConversations } from "@/lib/data/queries";
import { env } from "@/lib/env";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata = { title: "Чаты" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant") redirect("/app/billing");
  const sp = await searchParams;
  return <InboxView conversations={listConversations(s)} me={s.userId} openId={sp.open} canSimulate={env.DATA_SOURCE === "mock"} />;
}
