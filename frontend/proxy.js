import { NextResponse } from "next/server";
import { auth } from "./auth";

function isPublicPath(pathname) {
  return (
    pathname.startsWith("/api/auth") ||
    pathname === "/sign-in" ||
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico"
  );
}

export default auth((request) => {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
    const userId = request.auth?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const backendPath = pathname.replace(/^\/api/, "/backend/api");
    const target = new URL(`${backendPath}${search}`, request.url);
    const headers = new Headers(request.headers);
    headers.set("x-user-id", userId);
    headers.set("x-internal-api-secret", process.env.INTERNAL_API_SECRET || "");
    headers.delete("host");

    return NextResponse.rewrite(target, {
      request: {
        headers,
      },
    });
  }

  if (!isPublicPath(pathname) && !request.auth?.user) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
