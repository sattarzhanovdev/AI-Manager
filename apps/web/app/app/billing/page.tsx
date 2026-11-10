import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { isDisabledInMvp } from "@/lib/data/repo";
import { MvpDisabled } from "@/components/mvp/mvp-disabled";
import { can } from "@/lib/permissions";
import { getUsage, getCurrentPlan, getPlans, getInvoices } from "@/lib/data/repo";
import { BillingView } from "@/components/billing/billing-view";

export const metadata = { title: "Тариф и счета" };

export default async function BillingPage() {
  const s = await requireSession();
  if (isDisabledInMvp("billing")) return <MvpDisabled />;
  if (!can(s.member.role, "view_billing")) redirect("/app");
  return <BillingView usage={(await getUsage(s))} plan={(await getCurrentPlan(s))} plans={(await getPlans(s))} invoices={(await getInvoices(s))} canManage={s.member.role === "owner"} />;
}
