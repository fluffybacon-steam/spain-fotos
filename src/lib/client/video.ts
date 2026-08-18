// src/lib/client/video.ts

export type VideoMeta = {
  lat: number | null;
  lng: number | null;
  takenAt: Date | null;
  width: number;
  height: number;
  durationMs: number;
};

/**
 * Video location has nothing to do with EXIF. MP4 and QuickTime store it in a
 * `moov/udta/©xyz` box as an ISO 6709 string ("+39.5960+003.3830+017.234/"),
 * or in an older `loci` box. exifr doesn't read either, so this walks the box
 * tree directly.
 *
 * Recorded video usually puts `moov` at the *end* of the file, so we read box
 * headers one at a time and only fetch the payload we need. A 400 MB clip costs
 * a few KB of reads rather than being pulled into memory.
 */

const HEADER = 8;

async function readSlice(file: File, start: number, end: number): Promise<DataView> {
  const buf = await file.slice(start, Math.min(end, file.size)).arrayBuffer();
  return new DataView(buf);
}

function boxType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Walk top-level boxes and return the byte range of the named one. */
async function findTopLevelBox(file: File, want: string): Promise<{ start: number; end: number } | null> {
  let offset = 0;
  // Guard against malformed files spinning us forever.
  for (let i = 0; i < 64 && offset + HEADER <= file.size; i++) {
    const head = await readSlice(file, offset, offset + 16);
    if (head.byteLength < HEADER) return null;

    let size = head.getUint32(0);
    const type = boxType(head, 4);
    let headerLength = HEADER;

    if (size === 1) {
      if (head.byteLength < 16) return null;
      // 64-bit size. Beyond 2^53 is not a real file; take the low half.
      size = Number(head.getBigUint64(8));
      headerLength = 16;
    } else if (size === 0) {
      size = file.size - offset;
    }
    if (size < headerLength) return null;

    if (type === want) return { start: offset + headerLength, end: offset + size };
    offset += size;
  }
  return null;
}

/** Depth-first search for a box inside an already-loaded buffer. */
function findNested(
  view: DataView,
  wanted: string,
  start = 0,
  end = view.byteLength,
  depth = 0,
): { start: number; end: number } | null {
  let offset = start;
  while (offset + HEADER <= end) {
    let size = view.getUint32(offset);
    const type = boxType(view, offset + 4);
    let headerLength = HEADER;

    if (size === 1) {
      if (offset + 16 > end) return null;
      size = Number(view.getBigUint64(offset + 8));
      headerLength = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerLength) return null;

    const bodyStart = offset + headerLength;
    const bodyEnd = Math.min(offset + size, end);

    if (type === wanted) return { start: bodyStart, end: bodyEnd };

    // Container boxes worth descending into. Everything else is leaf data.
    if (depth < 6 && ["moov", "udta", "trak", "meta", "ilst"].includes(type)) {
      // `meta` is a full box: one version byte plus three flag bytes first.
      const descendFrom = type === "meta" ? bodyStart + 4 : bodyStart;
      const hit = findNested(view, wanted, descendFrom, bodyEnd, depth + 1);
      if (hit) return hit;
    }

    offset += size;
  }
  return null;
}

/** "+39.5960+003.3830+017.234/" → { lat, lng } */
export function parseIso6709(value: string): { lat: number; lng: number } | null {
  const match = value.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function decodeUtf8(view: DataView, start: number, end: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + start, end - start);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * QuickTime epoch is 1904-01-01 UTC, not 1970. The offset is 2,082,844,800
 * seconds. Values are frequently written as local time with no zone, so treat
 * this as approximate — good enough to sort a trip, not to the second.
 */
const QT_EPOCH_OFFSET = 2_082_844_800;

function parseMvhdTime(view: DataView, start: number): Date | null {
  const version = view.getUint8(start);
  const created = version === 1 ? Number(view.getBigUint64(start + 4)) : view.getUint32(start + 4);
  if (!created) return null;
  const unix = created - QT_EPOCH_OFFSET;
  if (unix < 0 || unix > 4_102_444_800) return null; // sanity: 1970 .. 2100
  return new Date(unix * 1000);
}

export async function readVideoLocation(
  file: File,
): Promise<{ lat: number | null; lng: number | null; takenAt: Date | null }> {
  const empty = { lat: null, lng: null, takenAt: null };
  try {
    const moov = await findTopLevelBox(file, "moov");
    if (!moov) return empty;

    // moov is metadata only; a few MB at most even for long recordings.
    const size = moov.end - moov.start;
    if (size <= 0 || size > 32 * 1024 * 1024) return empty;
    const view = await readSlice(file, moov.start, moov.end);

    let lat: number | null = null;
    let lng: number | null = null;

    const xyz = findNested(view, "\u00A9xyz");
    if (xyz) {
      // Payload: 2-byte length, 2-byte language code, then the string.
      const text = decodeUtf8(view, xyz.start + 4, xyz.end);
      const parsed = parseIso6709(text);
      if (parsed) ({ lat, lng } = parsed);
    }

    if (lat === null) {
      const loci = findNested(view, "loci");
      if (loci) {
        const text = decodeUtf8(view, loci.start, loci.end);
        const parsed = parseIso6709(text);
        if (parsed) ({ lat, lng } = parsed);
      }
    }

    const mvhd = findNested(view, "mvhd");
    const takenAt = mvhd ? parseMvhdTime(view, mvhd.start) : null;

    return { lat, lng, takenAt };
  } catch {
    return empty;
  }
}

/**
 * Pull dimensions, duration and a poster frame by decoding in a hidden video
 * element. This only works when the browser can actually decode the codec —
 * Chrome on desktop can't play HEVC, which is what iPhones record by default.
 * The caller gets `poster: null` in that case rather than an exception.
 */
export async function readVideoFrame(
  file: File,
): Promise<{ width: number; height: number; durationMs: number; poster: Blob | null }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitFor(video, "loadedmetadata", 15_000);
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;

    let poster: Blob | null = null;
    try {
      // A second in avoids the black frame most recordings start on.
      video.currentTime = Math.min(1, (video.duration || 1) / 3);
      await waitFor(video, "seeked", 15_000);

      const scale = Math.min(1, 512 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (ctx && width && height) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        poster = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72),
        );
      }
    } catch {
      poster = null; // undecodable codec — handled by the caller
    }

    return { width, height, durationMs, poster };
  } finally {
    video.src = "";
    URL.revokeObjectURL(url);
  }
}

function waitFor(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("This video couldn't be decoded in the browser"));
    };
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
    }
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

/** A dark tile with a play glyph, for videos whose codec the browser can't decode. */
export function placeholderPoster(): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  ctx.fillStyle = "#17313c";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#7c9aa4";
  ctx.beginPath();
  ctx.moveTo(215, 190);
  ctx.lineTo(330, 256);
  ctx.lineTo(215, 322);
  ctx.closePath();
  ctx.fill();

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8));
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
