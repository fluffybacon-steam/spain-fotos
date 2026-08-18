// src/app/api/photos/route.ts
import { NextResponse } from "next/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, photos, users, reactions, comments, REACTION_KINDS, type ReactionKind } from "@/db";
import { requireUser, guard } from "@/lib/session";
import type { PhotoDTO } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptyTally = () =>
  Object.fromEntries(REACTION_KINDS.map((k) => [k, 0])) as Record<ReactionKind, number>;

export const GET = guard(async () => {
  const me = await requireUser();

  const rows = await db
    .select({
      photo: photos,
      ownerName: users.name,
      ownerAvatarKey: users.avatarKey,
    })
    .from(photos)
    .innerJoin(users, eq(users.id, photos.ownerId))
    .orderBy(desc(photos.takenAt), desc(photos.createdAt));

  const ids = rows.map((r) => r.photo.id);
  const allReactions = ids.length
    ? await db.select().from(reactions).where(inArray(reactions.photoId, ids))
    : [];

  const commentRows = ids.length
    ? await db
        .select({ photoId: comments.photoId, n: sql<number>`cast(count(*) as int)` })
        .from(comments)
        .where(inArray(comments.photoId, ids))
        .groupBy(comments.photoId)
    : [];
  const commentCounts = new Map(commentRows.map((r) => [r.photoId, r.n]));

  const tallies = new Map<string, Record<ReactionKind, number>>();
  const mine = new Map<string, ReactionKind>();
  for (const r of allReactions) {
    const tally = tallies.get(r.photoId) ?? emptyTally();
    tally[r.kind] = (tally[r.kind] ?? 0) + 1;
    tallies.set(r.photoId, tally);
    if (r.userId === me.uid) mine.set(r.photoId, r.kind);
  }

  const items: PhotoDTO[] = rows.map(({ photo: p, ownerName, ownerAvatarKey }) => ({
    id: p.id,
    ownerId: p.ownerId,
    ownerName,
    ownerAvatarUrl: ownerAvatarKey ? `/api/img/${p.ownerId}/avatar` : null,
    mediaType: (p.mediaType === "video" ? "video" : "photo") as "photo" | "video",
    durationMs: p.durationMs,
    thumbUrl: `/api/img/${p.id}/thumb`,
    displayUrl: `/api/img/${p.id}/display`,
    originalUrl: `/api/img/${p.id}/original`,
    downloadUrl: `/api/img/${p.id}/original?download=1`,
    width: p.width,
    height: p.height,
    lat: p.lat,
    lng: p.lng,
    locationSource: p.locationSource,
    takenAt: p.takenAt ? p.takenAt.toISOString() : null,
    cameraMake: p.cameraMake,
    cameraModel: p.cameraModel,
    caption: p.caption,
    originalName: p.originalName,
    originalBytes: p.originalBytes,
    commentCount: commentCounts.get(p.id) ?? 0,
    reactions: tallies.get(p.id) ?? emptyTally(),
    myReaction: mine.get(p.id) ?? null,
  }));

  return NextResponse.json({ photos: items });
});

const CreateBody = z.object({
  records: z
    .array(
      z.object({
        id: z.string().min(8).max(32),
        originalKey: z.string().min(1),
        displayKey: z.string().min(1),
        thumbKey: z.string().min(1),
        mediaType: z.enum(["photo", "video"]).default("photo"),
        durationMs: z.number().int().nonnegative().nullable().default(null),
        contentHash: z.string().max(80).nullable().default(null),
        originalName: z.string().min(1).max(255),
        originalMime: z.string().max(120),
        originalBytes: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        lat: z.number().min(-90).max(90).nullable(),
        lng: z.number().min(-180).max(180).nullable(),
        locationSource: z.enum(["exif", "manual"]).nullable(),
        takenAt: z
          .string()
          .refine((v) => !Number.isNaN(Date.parse(v)), "Not a date")
          .nullable(),
        cameraMake: z.string().max(80).nullable(),
        cameraModel: z.string().max(80).nullable(),
      }),
    )
    .min(1)
    .max(25),
});

/** Called after the client has finished PUTting all three objects to R2. */
export const POST = guard(async (req: Request) => {
  const me = await requireUser();
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const rows = parsed.data.records
    // Keys are namespaced by user id at presign time; re-check so a crafted
    // request can't register objects sitting in someone else's prefix.
    .filter((r) => r.originalKey.startsWith(`photos/${me.uid}/${r.id}/`))
    .map((r) => ({
      id: r.id,
      ownerId: me.uid,
      originalKey: r.originalKey,
      displayKey: r.displayKey,
      thumbKey: r.thumbKey,
      mediaType: r.mediaType,
      durationMs: r.durationMs,
      contentHash: r.contentHash,
      originalName: r.originalName,
      originalMime: r.originalMime,
      originalBytes: r.originalBytes,
      width: r.width,
      height: r.height,
      lat: r.lat,
      lng: r.lng,
      locationSource: r.locationSource,
      takenAt: r.takenAt ? new Date(r.takenAt) : null,
      cameraMake: r.cameraMake,
      cameraModel: r.cameraModel,
    }));

  if (!rows.length) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  await db.insert(photos).values(rows).onConflictDoNothing();
  return NextResponse.json({ ok: true, saved: rows.length });
});
