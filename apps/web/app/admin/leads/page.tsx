import { admin } from "@/lib/data/queries";
import { DemoLeadsView } from "@/components/admin/admin-views";
export default function Page() { return <DemoLeadsView rows={admin.demoLeads()} />; }
