// src/app/api/photos/[id]/route.ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, photos } from "@/db";
import { requireUser, guard } from "@/lib/session";
import { deleteObjects } from "@/lib/r2";

export const runtime = "nodejs";

const Patch = z.object({
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  caption: z.string().max(280).nullable().optional(),
});

/** Used by the pin-drop flow for photos that arrived without GPS. */
export const PATCH = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("caption" in parsed.data) patch.caption = parsed.data.caption;
  if ("lat" in parsed.data && "lng" in parsed.data) {
    patch.lat = parsed.data.lat;
    patch.lng = parsed.data.lng;
    patch.locationSource = parsed.data.lat === null ? null : "manual";
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const updated = await db
    .update(photos)
    .set(patch)
    .where(and(eq(photos.id, id), eq(photos.ownerId, me.uid)))
    .returning({ id: photos.id });

  if (!updated.length) return NextResponse.json({ error: "Not your photo" }, { status: 403 });
  return NextResponse.json({ ok: true });
});

export const DELETE = guard(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;

  const [row] = await db.select().from(photos).where(eq(photos.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Already gone" }, { status: 404 });
  if (row.ownerId !== me.uid && !me.admin) {
    return NextResponse.json({ error: "Only the person who uploaded this can remove it" }, { status: 403 });
  }

  await db.delete(photos).where(eq(photos.id, id));
  await deleteObjects([row.originalKey, row.displayKey, row.thumbKey]).catch(() => {});
  return NextResponse.json({ ok: true });
});
