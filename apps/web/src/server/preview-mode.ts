import { type NextRequest, NextResponse } from "next/server";
export function isUiPreview() {
  return process.env.RECALINO_UI_PREVIEW === "1" && process.env.VERCEL_ENV !== "production";
}
export function previewApiResponse(request: Request): Response | null {
  if (!isUiPreview()) return null;
  const url = new URL(request.url);
  if (url.pathname === "/api/health" && ["GET", "HEAD"].includes(request.method))
    return Response.json(
      { status: "ok", mode: "ui-preview" },
      { headers: { "cache-control": "no-store" } },
    );
  return Response.json(
    { error: { code: "preview_only", message: "This preview uses sample data only." } },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
export function previewResponse(request: NextRequest): NextResponse | null {
  if (!isUiPreview()) return null;
  const { pathname } = request.nextUrl;
  if (!["GET", "HEAD"].includes(request.method))
    return NextResponse.json(
      { error: { code: "preview_only", message: "This preview uses sample data only." } },
      { status: 403 },
    );
  if (pathname === "/api/health") return NextResponse.json({ status: "ok", mode: "ui-preview" });
  if (
    pathname === "/preview" ||
    pathname.startsWith("/preview/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest"
  )
    return NextResponse.next();
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/") || pathname.startsWith("/dev/"))
    return NextResponse.json(
      { error: { code: "preview_only", message: "This preview uses sample data only." } },
      { status: 403 },
    );
  const mapped: Record<string, string> = {
    "/": "today",
    "/today": "today",
    "/classes": "classes",
    "/review": "review",
    "/me": "profile",
    "/setup": "setup-explanations",
    "/consent": "renew-consent",
  };
  if (mapped[pathname])
    return NextResponse.redirect(new URL(`/preview/${mapped[pathname]}`, request.url));
  return new NextResponse("This page is unavailable in the design preview.", { status: 404 });
}
