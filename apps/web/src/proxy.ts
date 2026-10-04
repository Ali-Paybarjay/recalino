import { readSupabaseEnv } from "@recalino/core/config";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_OPTIONS } from "./server/auth/supabase";
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
