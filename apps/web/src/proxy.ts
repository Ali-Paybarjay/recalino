import { readSupabaseEnv } from "@recalino/core/config";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { authFetch, SESSION_COOKIE_OPTIONS } from "./server/auth/supabase";
import { previewResponse } from "./server/preview-mode";

/**
 * Next.js proxy (FR-PLT-001): Server Components can't write cookies, so expired Auth tokens are
 * refreshed here and passed both to the page being rendered and back to the browser. It decides
 * nothing about access; pages and routes check the session themselves.
 */
export async function proxy(request: NextRequest) {
  const preview = previewResponse(request);
  if (preview) return preview;
  if (request.nextUrl.pathname === "/preview" || request.nextUrl.pathname.startsWith("/preview/")) {
    return NextResponse.next();
  }
  if (
    request.nextUrl.pathname === "/api/health" ||
    request.nextUrl.pathname.startsWith("/api/jobs/") ||
    request.nextUrl.pathname.startsWith("/_next/") ||
    request.nextUrl.pathname.startsWith("/icons/") ||
    request.nextUrl.pathname === "/manifest.webmanifest"
  ) {
    return NextResponse.next();
  }
  let response = NextResponse.next({ request });
  // Auth callbacks can write cookies later in a Route Handler, after this refresh. Keep those
  // responses and private page/API responses out of shared caches even without a token refresh.
  const authHeaders = new Headers({ "Cache-Control": "private, no-store" });
  const env = readSupabaseEnv();
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    // PERF-03: a stalled token refresh or key download ends after five seconds.
    global: { fetch: authFetch },
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items, headers) => {
        for (const { name, value } of items) request.cookies.set(name, value);
        // Supabase sends cache headers only with its first cookie write. A later write must
        // preserve those headers and any earlier cookie chunks when rebuilding the response.
        for (const [name, value] of Object.entries(headers)) authHeaders.set(name, value);
        const earlierCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        for (const cookie of earlierCookies) response.cookies.set(cookie);
        for (const { name, value, options } of items) {
          response.cookies.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
        }
      },
    },
  });
  await supabase.auth.getClaims();
  authHeaders.forEach((value, name) => {
    response.headers.set(name, value);
  });
  return response;
}

export const config = {
  // Jobs and health are matched so fixture mode can refuse them before any handler runs.
  // Outside fixture mode they skip session refresh above.
  matcher: [
    "/((?!_next/static|_next/image|icons/|manifest.webmanifest).*)",
    // Next can parse actions before rejecting an otherwise static URL. Catch both
    // client action requests and native action forms before that lookup in fixture mode.
    { source: "/:path*", has: [{ type: "header", key: "next-action" }] },
    {
      source: "/:path*",
      has: [{ type: "header", key: "content-type", value: "multipart/form-data.*" }],
    },
    {
      source: "/:path*",
      has: [{ type: "header", key: "content-type", value: "application/x-www-form-urlencoded.*" }],
    },
  ],
};
