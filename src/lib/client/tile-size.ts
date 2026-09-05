"use client";
// src/lib/client/tile-size.ts

import { useCallback, useEffect, useState } from "react";

/**
 * Thumbnail size is stored as a *target tile width* rather than a column count.
 *
 * One number then means the same thing everywhere: the grid is
 * `repeat(auto-fill, minmax(size, 1fr))` and the number of columns falls out of
 * whatever width is going. A column count would have to mean something
 * different on a phone and a desktop, and the map panel — which the user can
 * now drag wider — has no fixed width to count against at all.
 *
 * The scale stops at 256. Uploads generate a 512px thumbnail (THUMB_MAX in
 * lib/client/prepare.ts), so 256 CSS pixels is exactly one thumbnail on a 2x
 * display: the point past which bigger tiles would mean pulling the 2560px
 * display variant for every tile in the grid.
 */
export const TILE_STEPS = [88, 116, 152, 200, 256];

const LAST_STEP = TILE_STEPS.length - 1;

const STORAGE_PREFIX = "cala:tile-size:";

/**
 * Under this the viewport is a phone, where the wide default would land on two
 * columns. Only used before anyone has expressed a preference — once they have,
 * their number wins at every width.
 */
const NARROW = 640;

function clampStep(n: number): number {
  return Math.min(LAST_STEP, Math.max(0, n));
}

export type TileSize = {
  /** Target tile width in CSS pixels, for `minmax()`. */
  size: number;
  step: number;
  stepCount: number;
  canGrow: boolean;
  canShrink: boolean;
  grow: () => void;
  shrink: () => void;
};

/**
 * A remembered thumbnail size for one grid, per device.
 *
 * `surface` keys the storage, so the gallery and the map panel keep separate
 * numbers — they're different widths and the same tile size doesn't suit both.
 *
 * The stored value is read in an effect rather than during render: this is a
 * client component that still gets server-rendered, and reading localStorage
 * on the way past would make the markup disagree with itself on hydration.
 * Nothing is visible in that gap anyway — the grids are all waiting on
 * /api/photos, which resolves later than this does.
 */
export function useTileSize(surface: string, wideDefault: number): TileSize {
  const key = STORAGE_PREFIX + surface;
  const [step, setStep] = useState(wideDefault);

  useEffect(() => {
    let start = window.innerWidth < NARROW ? Math.min(wideDefault, 1) : wideDefault;
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        const n = Number.parseInt(saved, 10);
        if (Number.isFinite(n)) start = clampStep(n);
      }
    } catch {
      // Private mode, or storage switched off. The default is a fine answer.
    }
    setStep(clampStep(start));
  }, [key, wideDefault]);

  const nudge = useCallback(
    (delta: number) => {
      setStep((prev) => {
        const next = clampStep(prev + delta);
        try {
          localStorage.setItem(key, String(next));
        } catch {
          // Unwritable storage costs the preference at the next visit, not this one.
        }
        return next;
      });
    },
    [key],
  );

  const grow = useCallback(() => nudge(1), [nudge]);
  const shrink = useCallback(() => nudge(-1), [nudge]);

  return {
    size: TILE_STEPS[step],
    step,
    stepCount: TILE_STEPS.length,
    canGrow: step < LAST_STEP,
    canShrink: step > 0,
    grow,
    shrink,
  };
}

/**
 * The `grid-template-columns` for a tile size.
 *
 * `min(size, 100%)` rather than a bare `size`: a container narrower than one
 * tile — the map panel dragged in, a small phone at the top of the scale —
 * would otherwise lay out a column wider than itself and spill sideways.
 */
export function tileColumns(size: number): string {
  return `repeat(auto-fill, minmax(min(${size}px, 100%), 1fr))`;
}
