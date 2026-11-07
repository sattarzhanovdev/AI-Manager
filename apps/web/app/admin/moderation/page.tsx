import { admin } from "@/lib/data/queries";
import { ModerationView } from "@/components/admin/admin-views";
export default function Page() { return <ModerationView rows={admin.moderation()} />; }
