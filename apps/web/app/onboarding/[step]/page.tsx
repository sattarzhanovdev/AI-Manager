import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getQuestionnaire, getAssistant } from "@/lib/data/repo";
import { OnboardingView } from "@/components/onboarding/onboarding-view";

export const metadata = { title: "Подключение" };

export default async function OnboardingStep({ params }: { params: Promise<{ step: string }> }) {
  const s = await requireSession();
  if (s.member.role !== "owner") redirect("/app");
  const step = Number((await params).step);
  if (!Number.isInteger(step) || step < 1 || step > 10) notFound();
  const [q, assistant] = await Promise.all([getQuestionnaire(s), getAssistant(s)]);
  return <OnboardingView step={step} fields={q.fields} counts={{ services: q.services.filter((x) => x.active).length, staff: q.staff.length, faq: q.faq.filter((x) => x.active).length }} greeting={assistant.greeting} />;
}
