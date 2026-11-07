import { NextResponse, type NextRequest } from "next/server";

/** Быстрый редирект неавторизованных из кабинета и админки на /login (полная проверка — в layout) */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has("all_session") || [...req.cookies.getAll()].some((c) => c.name.startsWith("sb-"));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*", "/admin/:path*", "/onboarding/:path*"] };
