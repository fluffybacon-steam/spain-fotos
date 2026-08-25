// src/lib/r2.ts
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

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
  // S3's DeleteObjects refuses more than 1000 keys in one call, and a bulk
  // gallery delete passes three keys per photo — so the cap is reachable.
  for (let i = 0; i < keys.length; i += 1000) {
    await r2.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
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
/**
 * Every object in the bucket, following the continuation token to the end.
 *
 * One Class A operation per 1000 keys, so this is a maintenance-path call —
 * fine for the audit script and the rescue panel, not for a page render.
 */
export async function listAllObjects(): Promise<
  { key: string; bytes: number; modified: Date | null }[]
> {
  const out: { key: string; bytes: number; modified: Date | null }[] = [];
  let token: string | undefined;
 
  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || typeof obj.Size !== "number") continue;
      out.push({ key: obj.Key, bytes: obj.Size, modified: obj.LastModified ?? null });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
 
  return out;
}
 
/** Whole object into memory. Only call this on things known to be small. */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty body for ${key}`);
  return res.Body.transformToByteArray();
}
 
/**
 * A byte range, inclusive of both ends, as the Range header defines it.
 *
 * This is what keeps hashing a 400 MB video off the heap: the fingerprint only
 * ever needs the first and last few megabytes.
 */
export async function getObjectRange(key: string, start: number, end: number): Promise<Uint8Array> {
  const res = await r2.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=${start}-${end}` }),
  );
  if (!res.Body) throw new Error(`Empty body for ${key}`);
  return res.Body.transformToByteArray();
}

