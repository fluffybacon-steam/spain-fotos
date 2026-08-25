// src/app/api/photos/route.ts
import { NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  photos,
  users,
  reactions,
  comments,
  favorites,
  REACTION_KINDS,
  type ReactionKind,
} from "@/db";
import { requireUser, guard, requireMember } from "@/lib/session";
import type { PhotoDTO } from "@/types";
import { deleteObjects } from "@/lib/r2";

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

  // Scoped to the caller, not to `ids`: favorites are private, so nobody else's
  // rows are ever loaded, and one person's shortlist is small enough that
  // fetching it whole is cheaper than sending a list of photo ids back.
  const myFavorites = new Set(
    (
      await db
        .select({ photoId: favorites.photoId })
        .from(favorites)
        .where(eq(favorites.userId, me.uid))
    ).map((r) => r.photoId),
  );

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
    isFavorite: myFavorites.has(p.id),
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
  const me = await requireMember();
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  console.log("post /api/photos", parsed);

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

  // `returning()` after `onConflictDoNothing()` lists only the rows genuinely
  // written, which is the one authoritative answer to "was this a duplicate?".
  // photos_owner_hash_idx already knows; reporting `rows.length` regardless
  // threw that answer away and told the uploader a photo had been saved when
  // nothing had been.
  const inserted = await db
    .insert(photos)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: photos.id });

  const insertedIds = new Set(inserted.map((r) => r.id));
  const refused = rows.filter((r) => !insertedIds.has(r.id));

  // A refused row is one of two things and they need opposite answers. Either
  // the (owner, hash) index rejected it — a real duplicate — or this id is
  // already ours, meaning a save that landed before its response got lost is
  // being retried. The retry has to read as success, or a flaky connection
  // turns every re-send into a phantom duplicate.
  const retried = refused.length
    ? (
        await db
          .select({ id: photos.id })
          .from(photos)
          .where(
            and(
              eq(photos.ownerId, me.uid),
              inArray(
                photos.id,
                refused.map((r) => r.id),
              ),
            ),
          )
      ).map((r) => r.id)
    : [];

  const retriedIds = new Set(retried);
  const duplicates = refused.filter((r) => !retriedIds.has(r.id)).map((r) => r.id);

  return NextResponse.json({
    ok: true,
    saved: [...insertedIds, ...retriedIds],
    duplicates,
  });
});


const DeleteBody = z.object({ ids: z.array(z.string().min(8).max(32)).min(1).max(200) });
 
/**
 * Deletes many photos in one request.
 *
 * Same contract as PATCH /api/photos/location: partial success is normal, so
 * the answer is a list of what was acted on rather than a status. A selection
 * in the gallery routinely spans several people, and one photo you're not
 * allowed to remove must not sink the other forty.
 *
 * Permission is per row and matches DELETE /api/photos/[id] exactly — the
 * uploader, or an admin. Bulk is a convenience, never a wider grant.
 */
export const DELETE = guard(async (req: Request) => {
  const me = await requireMember();
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
 
  const rows = await db
    .select({
      id: photos.id,
      ownerId: photos.ownerId,
      originalKey: photos.originalKey,
      displayKey: photos.displayKey,
      thumbKey: photos.thumbKey,
    })
    .from(photos)
    .where(inArray(photos.id, parsed.data.ids));
 
  const found = new Set(rows.map((r) => r.id));
  // Asked to delete something that isn't there. The caller wanted it gone and
  // it's gone, so it's reported as removable rather than as a failure — but
  // separately, because "already gone" and "just deleted" aren't the same fact.
  const alreadyGone = parsed.data.ids.filter((id) => !found.has(id));
 
  const mine = rows.filter((r) => r.ownerId === me.uid || me.admin);
  const refused = rows.filter((r) => !(r.ownerId === me.uid || me.admin)).map((r) => r.id);
 
  if (mine.length) {
    await db.delete(photos).where(
      inArray(
        photos.id,
        mine.map((r) => r.id),
      ),
    );
    // Rows first, objects second, and a failure here is swallowed: a stranded
    // object is findable later by `npm run r2:audit`, whereas a row pointing at
    // bytes that are already gone is a photo broken in the app right now.
    await deleteObjects(mine.flatMap((r) => [r.originalKey, r.displayKey, r.thumbKey])).catch(
      () => {},
    );
  }
 
  return NextResponse.json({
    ok: true,
    deleted: mine.map((r) => r.id),
    alreadyGone,
    refused,
  });
});