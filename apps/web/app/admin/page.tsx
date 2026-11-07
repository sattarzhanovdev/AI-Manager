import { admin } from "@/lib/data/queries";
import { CompaniesView } from "@/components/admin/admin-views";
export const metadata = { title: "Суперадминка" };
export default function Page() { return <CompaniesView rows={admin.companies()} />; }
