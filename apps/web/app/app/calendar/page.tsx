import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { isDisabledInMvp } from "@/lib/data/repo";
import { MvpDisabled } from "@/components/mvp/mvp-disabled";
import { getCalendar } from "@/lib/data/queries";
import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata = { title: "Календарь" };

export default async function CalendarPage() {
  const s = await requireSession();
  if (isDisabledInMvp("calendar")) return <MvpDisabled />;
  if (s.member.role === "accountant") redirect("/app/billing");
  return <CalendarView data={getCalendar()} />;
}
