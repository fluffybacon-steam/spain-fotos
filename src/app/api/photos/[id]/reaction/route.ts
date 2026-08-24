// src/app/api/photos/[id]/reaction/route.ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, reactions, REACTION_KINDS } from "@/db";
import { guard, requireMember } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({ kind: z.enum(REACTION_KINDS).nullable() });

/** One reaction per person per photo. Sending null clears it. */
export const PUT = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown reaction" }, { status: 400 });

  if (parsed.data.kind === null) {
    await db.delete(reactions).where(and(eq(reactions.photoId, id), eq(reactions.userId, me.uid)));
    return NextResponse.json({ ok: true, kind: null });
  }

  await db
    .insert(reactions)
    .values({ photoId: id, userId: me.uid, kind: parsed.data.kind })
    .onConflictDoUpdate({
      target: [reactions.photoId, reactions.userId],
      set: { kind: parsed.data.kind, createdAt: new Date() },
    });

  return NextResponse.json({ ok: true, kind: parsed.data.kind });
});
