import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getUsage, getCurrentPlan, getPlans, getInvoices } from "@/lib/data/queries";
import { BillingView } from "@/components/billing/billing-view";

export const metadata = { title: "Тариф и счета" };

export default async function BillingPage() {
  const s = await requireSession();
  if (!can(s.member.role, "view_billing")) redirect("/app");
  return <BillingView usage={getUsage()} plan={getCurrentPlan()} plans={getPlans()} invoices={getInvoices()} canManage={s.member.role === "owner"} />;
}
