"use client";
// src/components/ZoomableImage.tsx

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

/**
 * A photo you can pinch, drag and double-tap into, with the gesture handled
 * here rather than by the browser.
 *
 * The browser's own pinch zooms the *visual viewport*, which is the wrong thing
 * to do to a `position: fixed` overlay: the header and footer scale up with the
 * photo and slide off the edges, and panning fights the fixed positioning. So
 * the frame takes `touch-action: none` and moves the photo itself with a
 * transform, which leaves the chrome where it is and keeps the photo inside its
 * own box.
 *
 * The source is the display variant (long edge 2560), not the original — an
 * original may be HEIC, which most browsers can't decode in an `<img>`.
 */

export type ZoomHandle = {
  /** Multiplies the current scale about the middle of the frame. */
  zoomBy: (factor: number) => void;
  /** Back to 1x and centred. */
  reset: () => void;
  /** Jumps between 1x and a readable zoom. */
  toggle: () => void;
  /** Nudges a zoomed photo by a number of CSS pixels. No-op at 1x. */
  panBy: (dx: number, dy: number) => void;
};

type Props = {
  src: string;
  alt: string;
  /** Dimensions of `src`, used until the real ones arrive with the decode. */
  width?: number;
  height?: number;
  /** Change this to drop the zoom — pass the photo id. */
  resetKey: string;
  /** Fires on the 1x boundary only, not on every frame of a pinch. */
  onZoomChange?: (zoomed: boolean) => void;
};

type Transform = { scale: number; x: number; y: number };

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };
/** Anything under this counts as "not zoomed", so a stray pixel isn't a state. */
const ZOOMED_AT = 1.01;
const TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 40;
/** Total finger travel below which a touch is still a tap and not a drag. */
const TAP_TRAVEL = 12;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

type Point = { x: number; y: number };

const ZoomableImage = forwardRef<ZoomHandle, Props>(function ZoomableImage(
  { src, alt, width, height, resetKey, onZoomChange },
  ref,
) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  /**
   * The transform lives in a ref and on the node, not in state: a pinch fires
   * a move event per frame, and a React render per frame would drop them on a
   * phone. State holds only the 1x boundary, which changes about twice a
   * gesture and is what the rest of the viewer actually needs to know.
   */
  const tRef = useRef<Transform>(IDENTITY);
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);

  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; mid: Point } | null>(null);
  const drag = useRef<Point | null>(null);
  const travel = useRef(0);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  /**
   * Where the photo actually is. `object-fit: contain` letterboxes it inside a
   * frame-sized box, so the box is not the picture: panning has to be bounded
   * by the visible pixels, or a portrait photo would drag away sideways into
   * its own empty margins.
   */
  const fitted = useCallback(() => {
    const frame = frameRef.current;
    const img = imgRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const nw = img?.naturalWidth || width || rect.width;
    const nh = img?.naturalHeight || height || rect.height;
    const k = Math.min(rect.width / nw, rect.height / nh);
    return { rect, w: nw * k, h: nh * k };
  }, [width, height]);

  /**
   * How far in is worth going. Past roughly 1.5x the source pixels a photo is
   * only bigger, not clearer, so the ceiling follows the image rather than
   * being a flat number — but never below 3x, or a small photo couldn't be
   * inspected at all.
   */
  const maxScale = useCallback(() => {
    const f = fitted();
    const natural = imgRef.current?.naturalWidth ?? width ?? 0;
    if (!f || !natural) return 4;
    return clamp((natural / f.w) * 1.5, 3, 8);
  }, [fitted, width]);

  const bounded = useCallback(
    (next: Transform, f: NonNullable<ReturnType<typeof fitted>>): Transform => {
      const maxX = Math.max(0, (f.w * next.scale - f.rect.width) / 2);
      const maxY = Math.max(0, (f.h * next.scale - f.rect.height) / 2);
      return {
        scale: next.scale,
        x: clamp(next.x, -maxX, maxX),
        y: clamp(next.y, -maxY, maxY),
      };
    },
    [],
  );

  const apply = useCallback(
    (next: Transform, animate = false) => {
      tRef.current = next;
      const img = imgRef.current;
      if (img) {
        img.style.transition = animate ? "transform 180ms ease-out" : "none";
        img.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
      }
      const now = next.scale > ZOOMED_AT;
      if (now !== zoomedRef.current) {
        zoomedRef.current = now;
        setZoomed(now);
      }
    },
    [],
  );

  /**
   * Scales about a point on the screen, so the bit of the photo under the
   * fingers (or the cursor) stays under them. Falls back to a clean identity
   * at the bottom of the range rather than leaving a photo at 1.001x nudged a
   * few pixels off centre.
   */
  const zoomAbout = useCallback(
    (target: number, px: number, py: number, animate = false) => {
      const f = fitted();
      if (!f) return;
      const cur = tRef.current;
      const scale = clamp(target, 1, maxScale());
      if (scale <= ZOOMED_AT) {
        apply(IDENTITY, animate);
        return;
      }
      const k = scale / cur.scale;
      const cx = f.rect.left + f.rect.width / 2;
      const cy = f.rect.top + f.rect.height / 2;
      const ux = px - cx;
      const uy = py - cy;
      apply(
        bounded({ scale, x: ux - (ux - cur.x) * k, y: uy - (uy - cur.y) * k }, f),
        animate,
      );
    },
    [fitted, maxScale, apply, bounded],
  );

  const zoomAboutCentre = useCallback(
    (target: number, animate = true) => {
      const f = fitted();
      if (!f) return;
      zoomAbout(target, f.rect.left + f.rect.width / 2, f.rect.top + f.rect.height / 2, animate);
    },
    [fitted, zoomAbout],
  );

  useImperativeHandle(
    ref,
    (): ZoomHandle => ({
      zoomBy: (factor) => zoomAboutCentre(tRef.current.scale * factor),
      reset: () => apply(IDENTITY, true),
      toggle: () => zoomAboutCentre(tRef.current.scale > ZOOMED_AT ? 1 : TAP_ZOOM),
      panBy: (dx, dy) => {
        if (tRef.current.scale <= ZOOMED_AT) return;
        const f = fitted();
        if (!f) return;
        apply(
          bounded({ ...tRef.current, x: tRef.current.x + dx, y: tRef.current.y + dy }, f),
          true,
        );
      },
    }),
    [zoomAboutCentre, apply, fitted, bounded],
  );

  // A new photo starts unzoomed. Also runs on mount, which is what re-applies
  // the transform to a freshly keyed <img> after React swaps the node.
  useEffect(() => {
    pointers.current.clear();
    pinch.current = null;
    drag.current = null;
    lastTap.current = null;
    apply(IDENTITY);
  }, [resetKey, apply]);

  useEffect(() => {
    onZoomChange?.(zoomed);
  }, [zoomed, onZoomChange]);

  // Rotating the phone changes the frame, and with it how far the photo is
  // allowed to be off centre. Re-bound rather than leaving it stranded.
  useEffect(() => {
    function onResize() {
      const f = fitted();
      if (!f) return;
      apply(tRef.current.scale <= ZOOMED_AT ? IDENTITY : bounded(tRef.current, f));
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [fitted, apply, bounded]);

  // Wheel has to be a native non-passive listener; React's onWheel is passive,
  // so preventDefault there is ignored and the page scrolls behind the viewer.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      // A trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel
      // arrives in coarse notches. Same gesture here, different sensitivity.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      zoomAbout(tRef.current.scale * factor, e.clientX, e.clientY);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAbout]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    travel.current = 0;

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: dist(a, b), mid: mid(a, b) };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = dist(a, b);
      const m = mid(a, b);
      const f = fitted();
      if (f && pinch.current.dist > 0) {
        const cur = tRef.current;
        const scale = clamp(cur.scale * (d / pinch.current.dist), 1, maxScale());
        const k = scale / cur.scale;
        const cx = f.rect.left + f.rect.width / 2;
        const cy = f.rect.top + f.rect.height / 2;
        // Anchored on the midpoint between the fingers, and following it, so
        // the pinch zooms and drags in one movement the way a map does.
        const ux = pinch.current.mid.x - cx;
        const uy = pinch.current.mid.y - cy;
        apply(
          bounded(
            { scale, x: m.x - cx - (ux - cur.x) * k, y: m.y - cy - (uy - cur.y) * k },
            f,
          ),
        );
      }
      pinch.current = { dist: d, mid: m };
      travel.current = Infinity; // a pinch is never a tap
      return;
    }

    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    travel.current += Math.abs(dx) + Math.abs(dy);
    drag.current = { x: e.clientX, y: e.clientY };

    // One finger on a photo at 1x is a swipe between photos, which belongs to
    // the viewer. Only take it once there's something to pan.
    if (tRef.current.scale <= ZOOMED_AT) return;
    const f = fitted();
    if (!f) return;
    apply(bounded({ ...tRef.current, x: tRef.current.x + dx, y: tRef.current.y + dy }, f));
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;

    if (pointers.current.size === 1) {
      // Lifting one finger of a pinch: re-anchor on the one still down, or the
      // photo jumps by the distance between them.
      const [only] = [...pointers.current.values()];
      drag.current = { x: only.x, y: only.y };
      return;
    }
    if (pointers.current.size > 1) return;

    drag.current = null;

    if (e.type === "pointerup" && travel.current < TAP_TRAVEL) {
      const now = performance.now();
      const prev = lastTap.current;
      const near =
        prev && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP;
      if (prev && near && now - prev.at < DOUBLE_TAP_MS) {
        lastTap.current = null;
        zoomAbout(tRef.current.scale > ZOOMED_AT ? 1 : TAP_ZOOM, e.clientX, e.clientY, true);
        return;
      }
      lastTap.current = { at: now, x: e.clientX, y: e.clientY };
    }

    // Settle: a photo pinched back down to 1x returns to the middle.
    if (tRef.current.scale <= ZOOMED_AT && (tRef.current.x !== 0 || tRef.current.y !== 0)) {
      apply(IDENTITY, true);
    }
  }

  return (
    <div
      ref={frameRef}
      className="zoom-frame"
      data-zoomed={zoomed || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      // The browser's picture-drag would otherwise start mid-pan on desktop.
      onDragStart={(e) => e.preventDefault()}
    >
      <img
        key={resetKey}
        ref={imgRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        draggable={false}
        // Bounds are guesswork until the real dimensions are known.
        onLoad={() => {
          const f = fitted();
          if (f) apply(bounded(tRef.current, f));
        }}
      />
    </div>
  );
});

export default ZoomableImage;
