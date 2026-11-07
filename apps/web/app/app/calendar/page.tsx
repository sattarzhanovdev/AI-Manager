import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getCalendar } from "@/lib/data/queries";
import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata = { title: "Календарь" };

export default async function CalendarPage() {
  const s = await requireSession();
  if (s.member.role === "accountant") redirect("/app/billing");
  return <CalendarView data={getCalendar()} />;
}
