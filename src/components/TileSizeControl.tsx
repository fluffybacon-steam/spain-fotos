"use client";
// src/components/TileSizeControl.tsx

import type { TileSize } from "@/lib/client/tile-size";

/**
 * Minus and plus over a fixed scale, the way a file browser does it.
 *
 * Discrete rather than a slider on purpose: the steps are chosen to divide the
 * usual container widths into whole columns, and a continuous control would let
 * people land between two of them on a half-column of dead space.
 *
 * The readout is there because both buttons go dead at the ends of the scale
 * and a disabled button on its own doesn't say whether you're at the top or the
 * bottom.
 */
export default function TileSizeControl({
  tile,
  label = "Size",
  className = "",
}: {
  tile: TileSize;
  /** Shown to screen readers; visible only when there's room for it. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={`${label} of thumbnails`}
      className={`flex items-center gap-1 ${className}`}
    >
      <button
        type="button"
        className="icon-btn icon-btn-sm text-lg leading-none"
        onClick={tile.shrink}
        disabled={!tile.canShrink}
        aria-label="Smaller thumbnails"
        title="Smaller thumbnails"
      >
        <span aria-hidden="true">−</span>
      </button>
      <span className="coord w-8 shrink-0 text-center tabular-nums" aria-hidden="true">
        {tile.step + 1}/{tile.stepCount}
      </span>
      <button
        type="button"
        className="icon-btn icon-btn-sm text-lg leading-none"
        onClick={tile.grow}
        disabled={!tile.canGrow}
        aria-label="Larger thumbnails"
        title="Larger thumbnails"
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
