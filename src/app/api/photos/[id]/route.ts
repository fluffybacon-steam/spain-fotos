// src/app/api/photos/[id]/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, photos } from "@/db";
import { requireUser, guard } from "@/lib/session";
import { deleteObjects } from "@/lib/r2";

export const runtime = "nodejs";

const Patch = z.object({
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  takenAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Not a date")
    .nullable()
    .optional(),
  caption: z.string().max(280).nullable().optional(),
});

/**
 * Corrects the survey data on one photo: where it was taken and when.
 *
 * Two different permission rules live here on purpose.
 *
 * Pin and timestamp are communal. Anyone signed in may correct either on any
 * photo, matching PATCH /api/photos/location. Both are facts about the trip
 * that the group collectively knows better than any single camera did — a
 * phone with a cold GPS fix, a clock left on the wrong timezone, or a photo
 * forwarded through a messaging app that stamped it with the moment it was
 * *received*. Locking those to the uploader means the person best placed to
 * fix them usually can't.
 *
 * Caption is authorship, not observation, so it stays with the owner (and
 * admins). Deletion likewise — see DELETE below. The asymmetry is the point:
 * a wrong pin or date is recoverable by the next person to notice, a deleted
 * photo is gone.
 */
export const PATCH = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("caption" in parsed.data) patch.caption = parsed.data.caption;
  if ("takenAt" in parsed.data) {
    patch.takenAt = parsed.data.takenAt === null ? null : new Date(parsed.data.takenAt!);
  }
  if ("lat" in parsed.data && "lng" in parsed.data) {
    patch.lat = parsed.data.lat;
    patch.lng = parsed.data.lng;
    patch.locationSource = parsed.data.lat === null ? null : "manual";
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  // The row is read first so a caption edit can be refused before it's written,
  // and so a missing photo answers 404 rather than a misleading 403.
  const [row] = await db
    .select({ ownerId: photos.ownerId })
    .from(photos)
    .where(eq(photos.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if ("caption" in patch && row.ownerId !== me.uid && !me.admin) {
    return NextResponse.json(
      { error: "Only the person who uploaded this can caption it" },
      { status: 403 },
    );
  }

  await db.update(photos).set(patch).where(eq(photos.id, id));
  return NextResponse.json({ ok: true });
});

/**
 * Unchanged, and deliberately stricter than the PATCH above: metadata is the
 * group's to correct, the photo itself is not the group's to remove.
 */
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
