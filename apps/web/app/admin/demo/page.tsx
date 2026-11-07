import { admin } from "@/lib/data/queries";
import { DemoLineView } from "@/components/admin/admin-views";
export default function Page() { return <DemoLineView calls={admin.demoCalls()} />; }
