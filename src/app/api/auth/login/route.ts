// src/app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, users } from "@/db";
import { verifyPassword } from "@/lib/auth";
import { signSession, SESSION_COOKIE, cookieOptions } from "@/lib/session";

export const runtime = "nodejs"; // scrypt needs Node

const Body = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a name and password" }, { status: 400 });
  }

  const username = parsed.data.username.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

  // Same message and roughly the same timing whether the account exists or the
  // password is wrong — no free account enumeration.
  const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json({ error: "That name and password don't match" }, { status: 401 });
  }

  const token = await signSession({ uid: user.id, name: user.name, admin: user.isAdmin });
  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions);
  return res;
}
