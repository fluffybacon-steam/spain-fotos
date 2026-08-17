// src/app/api/img/[id]/[variant]/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, photos, users } from "@/db";
import { requireUser, guard } from "@/lib/session";
import { presignDownload } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL = 3600;
// Expire the browser's cached redirect a little before the signature does, so
// nobody follows a stale URL into a 403.
const CACHE_SECONDS = TTL - 300;

/**
 * Everything in the bucket stays private. Rather than presigning every image
 * when the gallery loads — which would mean thousands of signatures per page —
 * the list returns stable URLs that point here, and this route checks the
 * session and 307s to a fresh signature.
 *
 * The redirect is privately cacheable, so each image costs one hop per hour and
 * the bytes themselves never pass through Vercel.
 */
export const GET = guard(async (
  req: Request,
  ctx: { params: Promise<{ id: string; variant: string }> },
) => {
  await requireUser(); // any signed-in friend may view any photo in the trip
  const { id, variant } = await ctx.params;

  if (variant === "avatar") {
    const [user] = await db
      .select({ avatarKey: users.avatarKey })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user?.avatarKey) return new NextResponse("No avatar", { status: 404 });
    return redirectTo(await presignDownload(user.avatarKey, { expiresIn: TTL }));
  }

  const [photo] = await db.select().from(photos).where(eq(photos.id, id)).limit(1);
  if (!photo) return new NextResponse("Not found", { status: 404 });

  const wantsDownload = new URL(req.url).searchParams.get("download") === "1";

  switch (variant) {
    case "thumb":
      return redirectTo(await presignDownload(photo.thumbKey, { expiresIn: TTL }));
    case "display":
      return redirectTo(await presignDownload(photo.displayKey, { expiresIn: TTL }));
    case "original":
      return redirectTo(
        await presignDownload(photo.originalKey, {
          expiresIn: TTL,
          contentType: photo.originalMime,
          filename: wantsDownload ? photo.originalName : undefined,
        }),
        wantsDownload,
      );
    default:
      return new NextResponse("Unknown image size", { status: 400 });
  }
});

function redirectTo(url: string, noStore = false) {
  const res = NextResponse.redirect(url, 307);
  res.headers.set(
    "Cache-Control",
    noStore ? "private, no-store" : `private, max-age=${CACHE_SECONDS}`,
  );
  return res;
}
