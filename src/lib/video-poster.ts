// src/lib/video-poster.ts

/**
 * Pulls a still out of a video file in the browser, for use as its thumbnail.
 *
 * The reason this exists: `URL.createObjectURL(file)` on a video hands back a
 * perfectly valid URL that an `<img>` cannot draw. There's no decoder behind an
 * image element, so the tile renders as a broken graphic. The frame has to come
 * out through a `<video>` element and a canvas.
 *
 * Everything here is best-effort. A codec the browser can't decode (HEVC on the
 * wrong platform, ProRes, anything exotic) resolves to `null` rather than
 * throwing — the caller shows a placeholder tile and, if it matters, asks the
 * server for a poster later.
 */

export type Poster = {
  /** Blob URL for a JPEG still. The caller owns it and must revoke it. */
  url: string;
  width: number;
  height: number;
};

export type PosterOptions = {
  /** Longest edge of the output, in CSS pixels. */
  maxEdge?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
  /** Give up on any single wait after this long. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Below this average-ish luma the frame is treated as a black fade-in. */
const BLANK_LUMA = 12;

/** rVFC should fire on the frame the seek presented; don't hang if it doesn't. */
const PAINT_GRACE_MS = 300;

export async function posterFromVideo(file: File, opts: PosterOptions = {}): Promise<Poster | null> {
  const { maxEdge = 320, quality = 0.82, timeoutMs = 10_000, signal } = opts;
  if (typeof document === "undefined") return null;

  const src = URL.createObjectURL(file);
  const video = document.createElement("video");

  // iOS refuses to decode a video that isn't laid out, and `display: none`
  // counts as not laid out. So: in the document, one pixel, invisible.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";

  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("muted", ""); // attribute form for older iOS
  video.setAttribute("playsinline", "");
  video.preload = "auto"; // "metadata" alone leaves some browsers unable to seek
  video.src = src;
  host.appendChild(video);
  document.body.appendChild(host);

  try {
    await waitForEvent(video, "loadedmetadata", timeoutMs, signal);

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;

    // Safari won't paint from a video that has never played. A muted play is
    // permitted without a gesture, so start it and stop it immediately.
    try {
      await video.play();
      video.pause();
    } catch {
      // Autoplay refused. Seeking alone usually still presents a frame.
    }

    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!ctx) return null;

    // Plenty of clips open on black. Take the first frame that isn't, and stop
    // hunting after three tries — a genuinely black video is a real answer.
    let drew = false;
    for (const t of candidateTimes(video.duration)) {
      throwIfAborted(signal);
      await seekTo(video, t, timeoutMs, signal);
      ctx.drawImage(video, 0, 0, cw, ch);
      drew = true;
      if (!looksBlank(ctx, cw, ch)) break;
    }
    if (!drew) return null;

    const blob = await toBlob(canvas, quality);
    if (!blob) return null;

    return { url: URL.createObjectURL(blob), width: cw, height: ch };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(src);
    // Detach the source or the decoder stays resident — twenty queued clips is
    // enough to get a mobile tab killed.
    video.removeAttribute("src");
    video.load();
    host.remove();
  }
}

/* ── internals ─────────────────────────────────────────────────────────── */

/** Where to look for a usable frame, in order. */
function candidateTimes(duration: number): number[] {
  // Live-recorded WebM often reports Infinity until fully buffered.
  const known = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const raw = known ? [Math.min(0.1, known / 2), Math.min(known * 0.1, 3), known * 0.25] : [0.1, 1, 2];
  const seen = new Set<number>();
  return raw
    .map((t) => Math.max(0, known ? Math.min(t, Math.max(0, known - 0.05)) : t))
    .filter((t) => {
      const k = Math.round(t * 100);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

async function seekTo(
  video: HTMLVideoElement,
  time: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (Math.abs(video.currentTime - time) > 0.001) {
    const seeked = waitForEvent(video, "seeked", timeoutMs, signal);
    video.currentTime = time;
    await seeked;
  }
  await nextPaintedFrame(video);
}

/**
 * `seeked` means the seek finished, not that a frame is on the surface to be
 * copied. drawImage before the frame lands gives a blank canvas.
 */
function nextPaintedFrame(video: HTMLVideoElement): Promise<void> {
  const rvfc = (
    video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    }
  ).requestVideoFrameCallback;

  if (typeof rvfc === "function") {
    return Promise.race([
      new Promise<void>((resolve) => rvfc.call(video, () => resolve())),
      delay(PAINT_GRACE_MS),
    ]);
  }
  // Two frames: one to commit the seek, one to be sure it composited.
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function waitForEvent(
  el: HTMLVideoElement,
  event: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fail);
      signal?.removeEventListener("abort", abort);
      err ? reject(err) : resolve();
    };
    const ok = () => done();
    const fail = () => done(new Error(`video ${event} failed`));
    const abort = () => done(new Error("aborted"));
    const timer = setTimeout(() => done(new Error(`video ${event} timed out`)), timeoutMs);

    if (signal?.aborted) return abort();
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", fail, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** True if nothing in the frame rises above near-black. */
function looksBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return false; // can't inspect it; assume it's fine rather than discard it
  }
  for (let i = 0; i < data.length; i += 4 * 7) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (luma > BLANK_LUMA) return false;
  }
  return true;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("aborted");
}
