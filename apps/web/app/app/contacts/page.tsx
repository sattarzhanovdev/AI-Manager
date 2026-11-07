import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listContacts } from "@/lib/data/repo";
import { isSupabase } from "@/lib/env";
import { ContactsView } from "@/components/contacts/contacts-view";

export const metadata = { title: "Контакты" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant") redirect("/app/billing");
  const sp = await searchParams;
  return <ContactsView contacts={await listContacts(s)} canErase={can(s.member.role, "export_delete")} canMerge={!isSupabase} open={sp.open} />;
}
