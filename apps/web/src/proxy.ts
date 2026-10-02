import { readSupabaseEnv } from "@recalino/core/config";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_OPTIONS } from "./server/auth/supabase";

/**
 * Next.js proxy (FR-PLT-001): Server Components can't write cookies, so expired Auth tokens are
 * refreshed here and passed both to the page being rendered and back to the browser. It decides
 * nothing about access; pages and routes check the session themselves.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = readSupabaseEnv();
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        for (const { name, value } of items) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of items) {
          response.cookies.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
        }
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Not for static files, icons, the manifest, the health check or the job runner: they never
  // touch a session.
  matcher: ["/((?!_next/static|_next/image|icons/|manifest.webmanifest|api/health|api/jobs/).*)"],
};
