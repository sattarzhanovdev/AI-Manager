import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED = ["/app", "/admin", "/onboarding"];
const isProtected = (path: string) => PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

function toLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

/**
 * supabase: обновляет access-токен в cookies (@supabase/ssr) и не пускает без сессии в приватные маршруты.
 * Полная проверка (пользователь + членство в компании) — в layout кабинета.
 * mock: быстрый редирект по cookie сессии.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (process.env.DATA_SOURCE === "django") {
    if (isProtected(path) && !req.cookies.has("all_django_session")) return toLogin(req);
    return NextResponse.next();
  }
  if (process.env.DATA_SOURCE !== "supabase") {
    if (isProtected(path) && !req.cookies.has("all_session")) return toLogin(req);
    return NextResponse.next();
  }
  let res = NextResponse.next({ request: req });
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return isProtected(path) ? toLogin(req) : res;
  const sb = createServerClient(url, key, {
    // Те же параметры cookie, что в lib/supabase/server.ts (httpOnly: токены недоступны JS страницы)
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) req.cookies.set(c.name, c.value);
        res = NextResponse.next({ request: req });
        for (const c of list) res.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  // Проверяем подпись JWT и при необходимости обновляем cookies. В отличие от
  // getUser(), getClaims() не делает обязательный сетевой Auth-запрос на
  // каждый переход при асимметричных ключах Supabase.
  const { data, error } = await sb.auth.getClaims();
  if ((error || !data?.claims?.sub) && isProtected(path)) {
    const redirect = toLogin(req);
    for (const c of res.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return res;
}

export const config = {
  // Обновление auth cookies нужно на защищённых маршрутах и API, а не
  // на лендинге, статических MP3 и прочих публичных ресурсах.
  matcher: ["/app/:path*", "/admin/:path*", "/onboarding/:path*", "/api/:path*"],
};
