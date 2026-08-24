// src/app/api/photos/[id]/favorite/route.ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, favorites, photos } from "@/db";
import { guard, requireMember } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({ favorite: z.boolean() });

/**
 * Stars or unstars one photo for the signed-in user.
 *
 * Idempotent in both directions — the client sends the state it wants rather
 * than a toggle, so a double tap on a slow connection can't land you on the
 * opposite answer from the one on screen.
 *
 * No permission check beyond being signed in: a favorite says nothing about the
 * photo, only about the person starring it, and every read is scoped to the
 * caller's own rows.
 */
export const PUT = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  if (!parsed.data.favorite) {
    await db.delete(favorites).where(and(eq(favorites.photoId, id), eq(favorites.userId, me.uid)));
    return NextResponse.json({ ok: true, favorite: false });
  }

  // A star on a photo someone else deleted a moment ago would fail the foreign
  // key as a 500. Read first so a stale tab gets a 404 it can explain.
  const [row] = await db.select({ id: photos.id }).from(photos).where(eq(photos.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "That foto is gone" }, { status: 404 });

  await db.insert(favorites).values({ photoId: id, userId: me.uid }).onConflictDoNothing();
  return NextResponse.json({ ok: true, favorite: true });
});
