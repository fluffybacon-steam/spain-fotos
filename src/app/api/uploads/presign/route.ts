// src/app/api/uploads/presign/route.ts
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { requireUser, guard } from "@/lib/session";
import { presignUpload, photoKeys } from "@/lib/r2";

export const runtime = "nodejs";

const Body = z.object({
  items: z
    .array(
      z.object({
        ext: z.string().regex(/^[a-z0-9]{1,5}$/i),
        originalMime: z.string().max(120),
      }),
    )
    .min(1)
    .max(25),
});

/**
 * Hands back three signed PUT URLs per photo. The photo id is minted here so
 * the client can address all three objects consistently before the DB row
 * exists — an abandoned upload just leaves orphaned objects, never a half row.
 */
export const POST = guard(async (req: Request) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const slots = await Promise.all(
    parsed.data.items.map(async ({ ext, originalMime }) => {
      const id = nanoid(16);
      const keys = photoKeys(user.uid, id, ext.toLowerCase());
      const mime = originalMime || "application/octet-stream";
      const [originalUrl, displayUrl, thumbUrl] = await Promise.all([
        presignUpload(keys.originalKey, mime),
        presignUpload(keys.displayKey, "image/jpeg"),
        presignUpload(keys.thumbKey, "image/jpeg"),
      ]);
      return { id, keys, uploads: { originalUrl, displayUrl, thumbUrl }, originalMime: mime };
    }),
  );

  return NextResponse.json({ slots });
});
