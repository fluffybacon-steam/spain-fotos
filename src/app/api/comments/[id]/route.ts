// src/app/api/comments/[id]/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, comments } from "@/db";
import { guard, requireMember } from "@/lib/session";

export const runtime = "nodejs";

export const DELETE = guard(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;

  const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
  if (!row) return NextResponse.json({ ok: true });
  if (row.userId !== me.uid && !me.admin) {
    return NextResponse.json({ error: "That isn't your comment" }, { status: 403 });
  }

  await db.delete(comments).where(eq(comments.id, id));
  return NextResponse.json({ ok: true });
});
