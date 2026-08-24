// src/app/api/photos/check/route.ts
import { NextResponse } from "next/server";
import { inArray, isNotNull, and } from "drizzle-orm";
import { z } from "zod";
import { db, photos, users } from "@/db";
import { eq } from "drizzle-orm";
import { guard, requireMember } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ hashes: z.array(z.string().max(80)).min(1).max(200) });

/**
 * Asked before any bytes move. Uploading a 12 MB photo only to have the insert
 * silently conflict wastes the uploader's data allowance and their patience, so
 * the client checks first and skips what's already there.
 *
 * Also reports matches owned by *other* people — not blocked, since two friends
 * may genuinely both hold the same photo, but worth telling the uploader.
 */
export const POST = guard(async (req: Request) => {
  const me = await requireMember();
  const parsed = Body.safeParse(await req.json().catch((e) => console.log(e)));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  console.log("parsed from api/check", parsed);

  const rows = await db
    .select({ hash: photos.contentHash, ownerId: photos.ownerId, ownerName: users.name })
    .from(photos)
    .innerJoin(users, eq(users.id, photos.ownerId))
    .where(and(isNotNull(photos.contentHash), inArray(photos.contentHash, parsed.data.hashes)));

  const mine: string[] = [];
  const others: Record<string, string> = {};
  for (const row of rows) {
    if (!row.hash) continue;
    if (row.ownerId === me.uid) mine.push(row.hash);
    else others[row.hash] = row.ownerName;
  }

  return NextResponse.json({ mine: [...new Set(mine)], others });
});
