// src/app/api/photos/location/route.ts
import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
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
 * Permission rule: anyone in the trip may place a photo that has no location,
 * because the group often remembers where a shot was taken when its owner
 * doesn't. Only the owner may move one that's already placed — so a correct
 * coordinate can never be overwritten by someone else's guess.
 */
export const PATCH = guard(async (req: Request) => {
  const me = await requireUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const updated = await db
    .update(photos)
    .set({ lat: parsed.data.lat, lng: parsed.data.lng, locationSource: "manual" })
    .where(
      and(
        inArray(photos.id, parsed.data.ids),
        or(eq(photos.ownerId, me.uid), isNull(photos.lat)),
      ),
    )
    .returning({ id: photos.id });

  return NextResponse.json({ ok: true, updated: updated.map((r) => r.id) });
});
