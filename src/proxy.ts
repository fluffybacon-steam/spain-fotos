// src/proxy.ts
import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";

const PUBLIC = [
  "/login",
  "/api/auth/login",
  "/api/auth/guest",
  "/manifest.webmanifest",
  "/old_insta.webp",
];

/**
 * Pages a view-only session has no business rendering. The API is gated route
 * by route with requireMember — this is only about not serving a page whose
 * entire purpose is a write, so a guest gets the map instead of an uploader
 * that would 403 on every button.
 */
const MEMBERS_ONLY = ["/upload"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    if (
      session.role === "guest" &&
      MEMBERS_ONLY.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      const home = req.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  // API callers get a status code; humans get sent to the door.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp|woff2)$).*)"],
};
