// src/app/api/auth/guest/route.ts
import { NextResponse } from "next/server";
import { signSession, SESSION_COOKIE, cookieOptions, GUEST_SESSION } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Starts a view-only session.
 *
 * There are no credentials to check — the button on the login screen is the
 * entire gate, so in practice the trip's photos are readable by anyone who has
 * the address. That's the deal being struck deliberately: a link you can send
 * to a parent without minting them an account.
 *
 * The cookie it sets is an ordinary session, so middleware lets it through and
 * every read route treats it like any other caller. What makes it view-only is
 * requireMember on the writing routes, not anything here.
 */
export async function POST() {
  const token = await signSession(GUEST_SESSION);
  const res = NextResponse.json({ ok: true, role: GUEST_SESSION.role });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions);
  return res;
}
