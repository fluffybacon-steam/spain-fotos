"use client";
// src/lib/client/tile-size.ts

import { useCallback, useEffect, useState } from "react";

/**
 * How many steps the −/+ control offers.
 *
 * This is the one number that has to agree with the stylesheet: the control
 * puts `size-1` … `size-{STEP_COUNT}` on the grid, and globals.css decides what
 * each of those means. Add a `.size-6` rule there and bump this, and the extra
 * step appears. Nothing here knows or cares how big a thumbnail is.
 */
export const STEP_COUNT = 5;

const STORAGE_PREFIX = "cala:tile-size:";

/** Under this the viewport is a phone, where a grid may want a different start. */
const NARROW = 640;

function clampStep(n: number): number {
  return Math.min(STEP_COUNT - 1, Math.max(0, n));
}

export type TileSize = {
  /** `size-1` … `size-N`, for the grid container. Style it in globals.css. */
  sizeClass: string;
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
 * numbers — they're very different widths and one setting doesn't suit both.
 *
 * The stored value is read in an effect rather than during render: these are
 * client components that still get server-rendered, and reading localStorage on
 * the way past would make the markup disagree with itself on hydration. Nothing
 * is visible in that gap anyway — the grids are all waiting on /api/photos,
 * which resolves later than this does.
 */
export function useTileSize(
  surface: string,
  { defaultStep, narrowDefaultStep = defaultStep }: { defaultStep: number; narrowDefaultStep?: number },
): TileSize {
  const key = STORAGE_PREFIX + surface;
  const [step, setStep] = useState(defaultStep);

  useEffect(() => {
    let start = window.innerWidth < NARROW ? narrowDefaultStep : defaultStep;
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        const n = Number.parseInt(saved, 10);
        if (Number.isFinite(n)) start = n;
      }
    } catch {
      // Private mode, or storage switched off. The default is a fine answer.
    }
    setStep(clampStep(start));
  }, [key, defaultStep, narrowDefaultStep]);

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
    sizeClass: `size-${step + 1}`,
    step,
    stepCount: STEP_COUNT,
    canGrow: step < STEP_COUNT - 1,
    canShrink: step > 0,
    grow,
    shrink,
  };
}
