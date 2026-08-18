// src/app/api/photos/[id]/comments/route.ts
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, comments, users } from "@/db";
import { requireUser, guard } from "@/lib/session";
import type { CommentDTO } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guard(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;

  const rows = await db
    .select({ comment: comments, authorName: users.name, avatarKey: users.avatarKey })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.photoId, id))
    .orderBy(asc(comments.createdAt));

  const items: CommentDTO[] = rows.map(({ comment: c, authorName, avatarKey }) => ({
    id: c.id,
    photoId: c.photoId,
    userId: c.userId,
    authorName,
    authorAvatarUrl: avatarKey ? `/api/img/${c.userId}/avatar` : null,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    mine: c.userId === me.uid,
  }));

  return NextResponse.json({ comments: items });
});

const Body = z.object({ body: z.string().trim().min(1).max(600) });

export const POST = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write something first" }, { status: 400 });

  const row = { id: nanoid(14), photoId: id, userId: me.uid, body: parsed.data.body };
  await db.insert(comments).values(row);

  const [author] = await db
    .select({ name: users.name, avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, me.uid))
    .limit(1);

  const dto: CommentDTO = {
    ...row,
    authorName: author?.name ?? me.name,
    authorAvatarUrl: author?.avatarKey ? `/api/img/${me.uid}/avatar` : null,
    createdAt: new Date().toISOString(),
    mine: true,
  };
  return NextResponse.json({ comment: dto });
});
