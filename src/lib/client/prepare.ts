// src/lib/client/prepare.ts
import { readExif, type PhotoExif } from "./exif";
import { readVideoLocation, readVideoFrame, placeholderPoster } from "./video";

export type PreparedPhoto = {
  file: File;
  exif: PhotoExif;
  display: Blob;
  thumb: Blob;
  width: number;
  height: number;
  ext: string;
  mediaType: "photo" | "video";
  durationMs: number | null;
  /** True when the codec wouldn't decode, so the poster is a placeholder. */
  posterFailed?: boolean;
};

const DISPLAY_MAX = 2560;
const THUMB_MAX = 512;
const DISPLAY_QUALITY = 0.86;
const THUMB_QUALITY = 0.72;

export function isHeicLike(file: File) {
  const t = file.type.toLowerCase();
  if (t === "image/heic" || t === "image/heif" || t === "image/heic-sequence") return true;
  // iOS sometimes hands over a file with an empty MIME type, so fall back to
  // the extension rather than silently rejecting a valid photo.
  return /\.(heic|heif)$/i.test(file.name) && (t === "" || t === "application/octet-stream");
}

export function isVideo(file: File) {
  return file.type.startsWith("video/") || /\.(mov|mp4|m4v|3gp|avi|mkv|webm)$/i.test(file.name);
}

export function isSupportedImage(file: File) {
  return file.type.startsWith("image/") || isHeicLike(file) || isVideo(file);
}

/**
 * Turn one picked file into everything the server needs.
 *
 * Order matters: EXIF comes off the original bytes first, then we decode.
 * `imageOrientation: "from-image"` bakes the EXIF Orientation tag into the
 * pixels — without it roughly half of any iPhone set renders sideways.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (isVideo(file)) return prepareVideo(file);

  const exif = await readExif(file);

  let decodable: Blob = file;
  let ext = extensionOf(file);

  if (isHeicLike(file)) {
    // Dynamic import: libheif is ~2 MB of WebAssembly and shouldn't be in the
    // initial bundle for people who only ever upload JPEGs.
    const { heicTo } = await import("heic-to");
    decodable = await heicTo({ blob: file, type: "image/jpeg", quality: 0.94 });
    ext = "heic";
  }

  const bitmap = await createImageBitmap(decodable, { imageOrientation: "from-image" });
  try {
    const display = await encode(bitmap, DISPLAY_MAX, DISPLAY_QUALITY);
    const thumb = await encode(bitmap, THUMB_MAX, THUMB_QUALITY);
    return {
      file,
      exif,
      display: display.blob,
      thumb: thumb.blob,
      width: display.width,
      height: display.height,
      ext,
      mediaType: "photo",
      durationMs: null,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Videos are uploaded untouched — no browser can transcode 400 MB of 4K in any
 * reasonable time, and R2 storage is cheaper than the attempt. What we generate
 * is a poster frame, which stands in for the still everywhere the app renders a
 * thumbnail.
 *
 * When the codec won't decode (Chrome on desktop cannot play the HEVC that
 * iPhones record by default) the poster falls back to a placeholder tile so the
 * upload still succeeds and the clip stays downloadable.
 */
async function prepareVideo(file: File): Promise<PreparedPhoto> {
  const location = await readVideoLocation(file);

  let width = 0;
  let height = 0;
  let durationMs = 0;
  let poster: Blob | null = null;

  try {
    const frame = await readVideoFrame(file);
    width = frame.width;
    height = frame.height;
    durationMs = frame.durationMs;
    poster = frame.poster;
  } catch {
    poster = null;
  }

  const posterFailed = !poster;
  if (!poster) poster = await placeholderPoster();
  if (!poster) throw new Error("Couldn't prepare this video");

  return {
    file,
    exif: {
      lat: location.lat,
      lng: location.lng,
      takenAt: location.takenAt ?? (file.lastModified ? new Date(file.lastModified) : null),
      cameraMake: null,
      cameraModel: null,
    },
    display: poster,
    thumb: poster,
    width: width || 1280,
    height: height || 720,
    ext: extensionOf(file),
    mediaType: "video",
    durationMs: durationMs || null,
    posterFailed,
  };
}

async function encode(bitmap: ImageBitmap, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });

  const ctx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Canvas is unavailable in this browser");

  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/jpeg", quality })
      : await new Promise<Blob>((resolve, reject) =>
          (canvas as HTMLCanvasElement).toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Encoding failed"))),
            "image/jpeg",
            quality,
          ),
        );

  return { blob, width, height };
}

function extensionOf(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  return file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
}

/** XHR rather than fetch, because fetch still has no upload progress events. */
export function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload rejected by storage (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.send(body);
  });
}
