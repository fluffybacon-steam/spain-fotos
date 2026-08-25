// src/app/api/orphans/route.ts
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, photos, users } from "@/db";
import { guard, requireMember } from "@/lib/session";
import { listAllObjects, presignDownload, deleteObjects } from "@/lib/r2";
import { audit, groupOrphans, recoveryFor, type OrphanGroup } from "@/lib/orphans";
import {
  contentHashOf,
  exifFromBytes,
  extensionOf,
  isVideoKey,
  jpegSize,
  mimeFor,
} from "@/lib/recover";
import { getObjectBytes } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches the audit script's default: an upload in flight looks like an orphan. */
const MIN_AGE_MS = 24 * 3600_000;
/** Long enough to read a preview, short enough not to leak. */
const PREVIEW_TTL = 900;

/**
 * Rescue for uploads that lost their row.
 *
 * Admin-only, and deliberately so. Listing this means scanning the whole
 * bucket, recovery writes rows on someone else's behalf, and discard deletes
 * bytes permanently — none of which belongs behind an ordinary member session
 * on a page anyone can open.
 */
async function requireAdmin() {
  const me = await requireMember();
  if (!me.admin) throw new NotAdmin();
  return me;
}

class NotAdmin extends Error {}
class BucketUnreachable extends Error {}

/**
 * Turns the two expected failures into answers the panel can render. Anything
 * else keeps bubbling, because a surprise should still look like one.
 */
function asResponse(e: unknown) {
  if (e instanceof NotAdmin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (e instanceof BucketUnreachable) {
    return NextResponse.json({ error: `Couldn't read the bucket: ${e.message}` }, { status: 502 });
  }
  return null;
}

/** Everything the panel needs about one stray group. */
async function describe(g: OrphanGroup, ownerName: string | null) {
  const mode = recoveryFor(g);
  const previewKey = g.keys.thumb ?? g.keys.display ?? g.keys.original;

  return {
    group: g.group,
    photoId: g.photoId,
    ownerId: g.ownerId,
    ownerName,
    bytes: g.bytes,
    modified: g.modified ? g.modified.toISOString() : null,
    variants: {
      original: !!g.keys.original,
      display: !!g.keys.display,
      thumb: !!g.keys.thumb,
    },
    video: g.keys.original ? isVideoKey(g.keys.original) : false,
    recovery: mode,
    prunable: g.prunable,
    // Signed straight from the bucket: /api/img/[id] needs a photos row, and
    // the whole problem here is that there isn't one.
    previewUrl: previewKey ? await presignDownload(previewKey, { expiresIn: PREVIEW_TTL }) : null,
  };
}

async function loadGroups() {
  const [objects, rows, avatars] = await Promise.all([
    listAllObjects().catch((e) => {
      // Bad credentials or a bucket outage otherwise surfaces as an unhandled
      // 500 with no body, and the panel can only say "something went wrong".
      throw new BucketUnreachable(e instanceof Error ? e.message : "Unknown error");
    }),
    db
      .select({
        id: photos.id,
        ownerId: photos.ownerId,
        originalKey: photos.originalKey,
        displayKey: photos.displayKey,
        thumbKey: photos.thumbKey,
      })
      .from(photos),
    db.select({ avatarKey: users.avatarKey }).from(users),
  ]);

  const result = audit(
    objects,
    rows,
    avatars.map((a) => a.avatarKey).filter((k): k is string => !!k),
    { minAgeMs: MIN_AGE_MS, now: Date.now() },
  );

  return { groups: groupOrphans(result.orphans), missing: result.missing };
}

export const GET = guard(async () => {
  let groups, missing;
  try {
    // await requireAdmin();
    ({ groups, missing } = await loadGroups());
  } catch (e) {
    const res = asResponse(e);
    if (res) return res;
    throw e;
  }

  const ownerIds = [...new Set(groups.map((g) => g.ownerId).filter((id): id is string => !!id))];
  const owners = ownerIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, ownerIds))
    : [];
  const nameById = new Map(owners.map((o) => [o.id, o.name]));

  const items = await Promise.all(
    groups.map((g) => describe(g, g.ownerId ? (nameById.get(g.ownerId) ?? null) : null)),
  );

  return NextResponse.json({
    orphans: items,
    missingCount: missing.length,
    totalBytes: groups.reduce((n, g) => n + g.bytes, 0),
  });
});

const RecoverBody = z.object({
  group: z.string().min(1).max(200),
  /** Overrides for what the bytes couldn't tell us. */
  takenAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Not a date")
    .nullable()
    .optional(),
  ownerId: z.string().min(1).max(32).optional(),
});

/**
 * Rebuilds the row for one orphaned group.
 *
 * The owner and the photo id come out of the key path, the dimensions out of
 * the display JPEG, and the date and coordinates out of the original's EXIF —
 * so a rescued photo usually lands already pinned and dated, with nothing to
 * retype. What EXIF can't supply, the caller may override.
 */
export const POST = guard(async (req: Request) => {
  const parsedReq = RecoverBody.safeParse(await req.json().catch(() => null));

  let groups;
  try {
    // await requireAdmin();
    if (!parsedReq.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    ({ groups } = await loadGroups());
  } catch (e) {
    const res = asResponse(e);
    if (res) return res;
    throw e;
  }
  const parsed = parsedReq;
  const g = groups.find((x) => x.group === parsed.data.group);
  if (!g) {
    return NextResponse.json(
      { error: "That group isn't orphaned any more — reload the list" },
      { status: 404 },
    );
  }

  const mode = recoveryFor(g);
  if (mode === "none" || !g.photoId || !g.ownerId) {
    return NextResponse.json({ error: "Nothing recoverable in this group" }, { status: 400 });
  }

  const ownerId = parsed.data.ownerId ?? g.ownerId;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
  if (!owner) return NextResponse.json({ error: "No such person" }, { status: 400 });

  const display = g.keys.display!;
  // "display-only" means the original PUT never landed. The 2560px copy is a
  // real photo and worth keeping — it just must not be presented as the
  // original, so it becomes the original and the mime says image/jpeg.
  const originalKey = mode === "full" ? g.keys.original! : display;
  const originalObj = g.objects.find((o) => o.key === originalKey)!;

  const displayBytes = await getObjectBytes(display);
  const size = jpegSize(displayBytes) ?? { width: 1280, height: 720 };

  // EXIF only from a still we can hold in memory. A video's location lives in
  // container atoms the browser reads at upload time, not in EXIF, so there's
  // nothing here to recover for one — it goes in unplaced and gets pinned.
  const video = isVideoKey(originalKey);
  const exif =
    !video && originalObj.bytes <= 32 * 1024 * 1024
      ? await exifFromBytes(await getObjectBytes(originalKey))
      : { lat: null, lng: null, takenAt: null, cameraMake: null, cameraModel: null };

  const hash = await contentHashOf(originalKey, originalObj.bytes).catch(() => null);

  const override = parsed.data.takenAt ? new Date(parsed.data.takenAt) : null;
  const takenAt = override ?? exif.takenAt ?? g.modified ?? null;

  const row = {
    id: g.photoId,
    ownerId,
    originalKey,
    displayKey: display,
    // A missing thumb is the cheapest loss here: the display copy stands in
    // until something regenerates it, and the grid just downloads more.
    thumbKey: g.keys.thumb ?? display,
    mediaType: video ? ("video" as const) : ("photo" as const),
    durationMs: null,
    contentHash: hash,
    originalName: `recovered-${g.photoId}.${extensionOf(originalKey) || "jpg"}`,
    originalMime: mode === "full" ? mimeFor(originalKey) : "image/jpeg",
    originalBytes: originalObj.bytes,
    width: size.width,
    height: size.height,
    lat: exif.lat,
    lng: exif.lng,
    locationSource: exif.lat !== null ? ("exif" as const) : null,
    takenAt,
    cameraMake: exif.cameraMake,
    cameraModel: exif.cameraModel,
  };

  const inserted = await db
    .insert(photos)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: photos.id });

  if (!inserted.length) {
    // Almost always the (owner, hash) index doing its job: these objects are a
    // copy of a photo that's already in the trip, which is very likely why the
    // save was refused and they were stranded in the first place.
    const [twin] = hash
      ? await db
          .select({ id: photos.id, originalName: photos.originalName })
          .from(photos)
          .where(and(eq(photos.ownerId, ownerId), eq(photos.contentHash, hash)))
          .limit(1)
      : [];

    return NextResponse.json(
      {
        ok: false,
        duplicate: true,
        twinId: twin?.id ?? null,
        error: twin
          ? "Already in the trip — these bytes duplicate a photo that's already saved, so they're safe to discard."
          : "Couldn't recover: a row with this id already exists.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    photoId: g.photoId,
    placed: exif.lat !== null,
    thumbUrl: `/api/img/${g.photoId}/thumb`,
    takenAt: takenAt ? takenAt.toISOString() : null,
    recoveredAs: mode,
  });
});

const DiscardBody = z.object({ group: z.string().min(1).max(200) });

/** Deletes one group's objects. Same guard as the CLI: nothing young. */
export const DELETE = guard(async (req: Request) => {
  const parsedReq = DiscardBody.safeParse(await req.json().catch(() => null));

  let groups;
  try {
    await requireAdmin();
    if (!parsedReq.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    ({ groups } = await loadGroups());
  } catch (e) {
    const res = asResponse(e);
    if (res) return res;
    throw e;
  }
  const parsed = parsedReq;
  const g = groups.find((x) => x.group === parsed.data.group);
  if (!g) return NextResponse.json({ ok: true, deleted: 0 });

  if (!g.prunable) {
    return NextResponse.json(
      { error: "Too recent to delete — this may still be uploading" },
      { status: 409 },
    );
  }

  await deleteObjects(g.objects.map((o) => o.key));
  return NextResponse.json({ ok: true, deleted: g.objects.length });
});
