// src/lib/session.ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "cala_session";
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days — nobody wants to re-enter this on a beach

/**
 * `guest` is a view-only session started from the login screen with no
 * credentials. It reads everything a member can and writes nothing.
 */
export type Role = "member" | "guest";

export type SessionPayload = { uid: string; name: string; admin: boolean; role: Role };

/**
 * Guests share one identity. It's never written to any table — a guest can't
 * create a row — and it only ever appears in reads scoped to "mine", where it
 * matches nothing: no favorites, no myReaction. Five characters can't collide
 * with a nanoid, so it can't accidentally borrow a real member's data either.
 */
export const GUEST_UID = "guest";

export const GUEST_SESSION: SessionPayload = {
  uid: GUEST_UID,
  name: "Guest",
  admin: false,
  role: "guest",
};

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
    // A token without a role predates view-only mode, and every one of those
    // was a member — sessions last 60 days, so treating the absence as "guest"
    // would silently demote everyone already signed in.
    const role: Role = payload.role === "guest" ? "guest" : "member";
    return {
      uid: payload.uid,
      name: String(payload.name ?? ""),
      // Belt and braces: a guest is never an admin, whatever the claim says.
      admin: role === "member" && payload.admin === true,
      role,
    };
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value);
}

export class Unauthorized extends Error {}
export class Forbidden extends Error {}

export async function requireUser(): Promise<SessionPayload> {
  const user = await currentUser();
  if (!user) throw new Unauthorized();
  return user;
}

/**
 * Requires a signed-in member. Every route that writes uses this instead of
 * requireUser, which is what actually makes view-only mode view-only: hiding
 * the buttons stops the app from offering a write, not from accepting one, and
 * a guest holds a perfectly valid session cookie to send with a hand-rolled
 * request.
 */
export async function requireMember(): Promise<SessionPayload> {
  const user = await requireUser();
  if (user.role === "guest") throw new Forbidden();
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
      if (err instanceof Forbidden) {
        // 403, not 401: the session is fine, it just isn't allowed to do this.
        // A 401 would send a perfectly valid guest back to the login screen.
        return Response.json(
          { error: "You're viewing without an account. Sign in to make changes." },
          { status: 403 },
        );
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
