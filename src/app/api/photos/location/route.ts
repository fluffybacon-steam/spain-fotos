// src/app/api/photos/location/route.ts
import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db, photos } from "@/db";
import { requireUser, guard } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({
  ids: z.array(z.string().min(8).max(32)).min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Bulk-place photos. Placing forty forwarded shots one at a time is the kind of
 * chore nobody finishes, so this takes a whole selection at once.
 *
 * Permission rule: anyone in the trip may place or move any photo, including
 * one that already has coordinates and including someone else's. Where a shot
 * was taken is a fact about the trip rather than about whoever happened to
 * upload the file, and the group reliably remembers it better than a phone's
 * GPS chip did — a wrong pin is worth more to fix than to protect.
 *
 * Deletion is the opposite and stays owner-only: a bad pin is recoverable, a
 * deleted photo isn't. See DELETE /api/photos/[id].
 *
 * Every write lands as `locationSource: "manual"`, so the viewer keeps labelling
 * it "placed by hand" — the map never presents a group guess as a camera fix.
 */
export const PATCH = guard(async (req: Request) => {
  await requireUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const updated = await db
    .update(photos)
    .set({ lat: parsed.data.lat, lng: parsed.data.lng, locationSource: "manual" })
    .where(inArray(photos.id, parsed.data.ids))
    .returning({ id: photos.id });

  return NextResponse.json({ ok: true, updated: updated.map((r) => r.id) });
});
