import { djangoFetch, DjangoError } from "@/lib/django";
import { isDjango } from "@/lib/env";
export async function GET() {
  if (!isDjango) return new Response(null, { status: 404 });
  try {
    const data = await djangoFetch<unknown>("/export/");
    return Response.json(data, { headers: { "Content-Disposition": 'attachment; filename="all-manager-export.json"', "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: "export_failed" }, { status: e instanceof DjangoError ? e.status : 502 }); }
}
