// src/lib/session.ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "cala_session";
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days — nobody wants to re-enter this on a beach

export type SessionPayload = { uid: string; name: string; admin: boolean };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

// Edge-runtime safe: used by middleware as well as route handlers.
export async function readSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.uid !== "string") return null;
    return { uid: payload.uid, name: String(payload.name ?? ""), admin: payload.admin === true };
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value);
}

export class Unauthorized extends Error {}

export async function requireUser(): Promise<SessionPayload> {
  const user = await currentUser();
  if (!user) throw new Unauthorized();
  return user;
}

/**
 * Wraps a route handler so an Unauthorized throw becomes a 401 rather than an
 * unhandled 500. Middleware already gates /api, so this is the second lock —
 * but a handler that 500s on an auth failure is a handler that hides bugs.
 */
export function guard<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof Unauthorized) {
        return Response.json({ error: "Sign in to continue" }, { status: 401 });
      }
      throw err;
    }
  };
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};
