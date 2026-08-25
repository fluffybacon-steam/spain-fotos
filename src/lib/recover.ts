// src/lib/recover.ts
/**
 * Rebuilding the facts about a photo from the bytes that survived.
 *
 * An orphan has lost its row, which is where the width, the timestamp and the
 * coordinates lived — but none of that was invented at upload time. It was read
 * off the file, and the file is still sitting in the bucket. So rather than ask
 * someone to retype it, read it again.
 */
import { createHash } from "node:crypto";
import exifr from "exifr";
import { getObjectBytes, getObjectRange } from "./r2";
import type { PhotoExif } from "./client/exif";

// Must match src/lib/client/hash.ts exactly. A fingerprint computed here that
// disagrees with the browser's would make a rescued photo invisible to
// duplicate detection, and worse, would let the same photo back in twice.
const FULL_HASH_LIMIT = 32 * 1024 * 1024;
const SAMPLE_BYTES = 4 * 1024 * 1024;

const VIDEO_EXT = new Set(["mov", "mp4", "m4v", "3gp", "avi", "mkv", "webm"]);

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
};

export function extensionOf(key: string): string {
  const file = key.split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot === -1 ? "" : file.slice(dot + 1).toLowerCase();
}

export function isVideoKey(key: string) {
  return VIDEO_EXT.has(extensionOf(key));
}

export function mimeFor(key: string) {
  return MIME_BY_EXT[extensionOf(key)] ?? "application/octet-stream";
}

/**
 * The same fingerprint the browser computes, rebuilt from the stored object.
 *
 * Small files are hashed whole; above the limit it's size + head + tail, read
 * with ranged GETs so a large video never lands in memory. The mode prefix
 * keeps the two schemes apart exactly as the client does.
 */
export async function contentHashOf(key: string, size: number): Promise<string> {
  if (size <= FULL_HASH_LIMIT) {
    return "f:" + sha256(await getObjectBytes(key));
  }

  const head = await getObjectRange(key, 0, SAMPLE_BYTES - 1);
  const tail = await getObjectRange(key, Math.max(0, size - SAMPLE_BYTES), size - 1);

  const sizeTag = new TextEncoder().encode(String(size));
  const combined = new Uint8Array(sizeTag.length + head.byteLength + tail.byteLength);
  combined.set(sizeTag, 0);
  combined.set(head, sizeTag.length);
  combined.set(tail, sizeTag.length + head.byteLength);

  return "s:" + sha256(combined);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Width and height straight out of the JPEG's frame header.
 *
 * Every display and thumb this app writes is a JPEG from the canvas encoder,
 * including a video's poster frame — so one small parser covers every case and
 * saves pulling an image library into a route handler.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) break;

    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) break;

    // SOF0/1/2/3, 5-7, 9-11, 13-15 — every frame header except DHT/JPG/DAC.
    const isSOF =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isSOF) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }

    i += 2 + length;
  }
  return null;
}

const EMPTY: PhotoExif = {
  lat: null,
  lng: null,
  takenAt: null,
  cameraMake: null,
  cameraModel: null,
};

/**
 * EXIF from stored bytes. Mirrors readExif() in lib/client/exif.ts, including
 * the Null Island rule — a 0,0 fix is a GPS chip reporting failure, not a photo
 * taken in the Gulf of Guinea.
 */
export async function exifFromBytes(bytes: Uint8Array): Promise<PhotoExif> {
  try {
    const data = await exifr.parse(bytes, { tiff: true, exif: true, gps: true, mergeOutput: true });
    if (!data) return EMPTY;

    let lat = numeric(data.latitude);
    let lng = numeric(data.longitude);

    if (lat === null || lng === null) {
      const gps = await exifr.gps(bytes).catch(() => null);
      if (gps) {
        lat = numeric(gps.latitude);
        lng = numeric(gps.longitude);
      }
    }

    const usable = lat !== null && lng !== null && !(lat === 0 && lng === 0);

    return {
      lat: usable ? lat : null,
      lng: usable ? lng : null,
      takenAt: asDate(data.DateTimeOriginal) ?? asDate(data.CreateDate),
      cameraMake: str(data.Make),
      cameraModel: str(data.Model),
    };
  } catch {
    return EMPTY;
  }
}

function numeric(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s.slice(0, 80) : null;
}

function asDate(v: unknown): Date | null {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v : null;
}
