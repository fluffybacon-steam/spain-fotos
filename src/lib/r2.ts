// src/lib/r2.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const BUCKET = process.env.R2_BUCKET!;

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

/**
 * Presigned PUT so phones upload straight to R2. This is not an optimisation —
 * a 12 MB photo through a Next route handler would hit Vercel's 4.5 MB request
 * body cap and fail outright.
 *
 * The signature covers Content-Type, so the browser must send exactly this value.
 */
export function presignUpload(key: string, contentType: string, expiresIn = 900) {
  return getSignedUrl(r2, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), {
    expiresIn,
  });
}

export function presignDownload(
  key: string,
  opts: { expiresIn?: number; filename?: string; contentType?: string } = {},
) {
  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      // R2 honours these S3 response overrides, which is how "Download" gets a
      // sensible filename instead of a UUID.
      ...(opts.filename
        ? { ResponseContentDisposition: `attachment; filename="${sanitise(opts.filename)}"` }
        : {}),
      ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
    }),
    { expiresIn: opts.expiresIn ?? 3600 },
  );
}

export async function deleteObjects(keys: string[]) {
  if (!keys.length) return;
  await r2.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
}

function sanitise(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
}

export function photoKeys(userId: string, photoId: string, ext: string) {
  const base = `photos/${userId}/${photoId}`;
  return {
    originalKey: `${base}/original.${ext}`,
    displayKey: `${base}/display.jpg`,
    thumbKey: `${base}/thumb.jpg`,
  };
}
