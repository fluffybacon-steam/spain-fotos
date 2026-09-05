"use client";
// src/components/PhotoPanel.tsx

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PhotoDTO } from "@/types";
import Avatar from "./Avatar";
import { REACTIONS } from "./ReactionBar";
import TileSizeControl from "./TileSizeControl";
import { useTileSize } from "@/lib/client/tile-size";

/** Width of the side panel before anyone drags it, matching the old fixed one. */
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 880;
/** Map left visible either side of a fully dragged-out panel. */
const MAP_GUTTER = 96;
const WIDTH_KEY = "cala:panel-width";
/** One arrow key press on the resize handle. */
const NUDGE = 24;

function clampWidth(px: number): number {
  const ceiling =
    typeof window === "undefined"
      ? MAX_WIDTH
      : Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - MAP_GUTTER));
  return Math.round(Math.min(ceiling, Math.max(MIN_WIDTH, px)));
}

/**
 * Sits over the map: a bottom sheet on phones, a side panel on wide screens.
 * The grid is deliberately dense — people scan a cluster for the one shot they
 * want, they don't read it — but how dense is theirs to say.
 */
export default function PhotoPanel({
  photos,
  onSelect,
  onClose,
  title,
  scrollTop,
  focusId,
}: {
  photos: PhotoDTO[];
  onSelect: (index: number) => void;
  onClose: () => void;
  title?: string;
  /**
   * Carries the grid's scroll position across the lightbox, which unmounts this
   * whole panel while it's up. Owned by the map page so it can decide when the
   * position is worth keeping: across a viewer round-trip, yes; across closing
   * the panel and tapping a pin again, no — that's a fresh look at a fresh
   * spot, and it starts at the top.
   */
  scrollTop?: React.RefObject<number>;
  /**
   * The photo the viewer was showing when it closed. Read once on mount and
   * cleared, so it only ever pulls the grid on the way back from the lightbox.
   */
  focusId?: React.RefObject<string | null>;
}) {
  // Step 3 is three columns, the panel's original `grid-cols-3`.
  const tile = useTileSize("panel", { defaultStep: 4 });
  const scroller = useRef<HTMLDivElement | null>(null);
  const tiles = useRef(new Map<string, HTMLElement>());

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    let start = DEFAULT_WIDTH;
    try {
      const saved = localStorage.getItem(WIDTH_KEY);
      if (saved !== null) {
        const n = Number.parseInt(saved, 10);
        if (Number.isFinite(n)) start = n;
      }
    } catch {
      // Storage off. The default width is a fine answer.
    }
    // Clamped on the way in as well as on the way out: a width saved on a wide
    // monitor would otherwise swallow the map on a laptop.
    setWidth(clampWidth(start));
  }, []);

  const commitWidth = useCallback((px: number) => {
    const next = clampWidth(px);
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Unwritable storage costs the width at the next visit, not this one.
    }
  }, []);

  /**
   * Restores the scroll position, then pulls the photo the viewer was last
   * showing into view if it has drifted off the visible part of the grid.
   *
   * Layout effect, not a plain one: the panel is remounted by the lightbox
   * closing, and a frame at the top before jumping down would be a visible
   * flinch every time. Mount-only — the ref is a handoff, not a subscription.
   *
   * Centred by arithmetic on the scroller rather than `scrollIntoView`, which
   * walks up and scrolls every ancestor it finds.
   */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = scrollTop?.current ?? 0;

    const id = focusId?.current ?? null;
    if (focusId) focusId.current = null;
    if (!id) return;

    const tileEl = tiles.current.get(id);
    if (!tileEl) return;
    const box = tileEl.getBoundingClientRect();
    const view = el.getBoundingClientRect();
    if (box.top >= view.top && box.bottom <= view.bottom) return;
    el.scrollTop += box.top - view.top - (view.height - box.height) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!photos.length) return null;

  const centre = photos.find((p) => p.lat !== null && p.lng !== null);
  const contributors = Array.from(new Set(photos.map((p) => p.ownerName)));

  return (
    <section
      className="glass absolute inset-x-0 bottom-0 z-40 flex max-h-[72vh] flex-col rounded-t-[6px] sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[var(--panel-w)] sm:max-h-none sm:rounded-none sm:rounded-l-[6px]"
      style={{ "--panel-w": `${width}px` } as React.CSSProperties}
      aria-label={title ?? "Photos at this location"}
    >
      {/* Wide screens only: on a phone this is a bottom sheet and there's no
          width to give it. Double-click puts it back. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        className="group absolute inset-y-0 left-0 z-10 hidden w-2 cursor-col-resize touch-none sm:block"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { startX: e.clientX, startWidth: width };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          // Dragging left widens: the panel is anchored to the right edge.
          setWidth(clampWidth(d.startWidth - (e.clientX - d.startX)));
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          drag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          commitWidth(width);
        }}
        onDoubleClick={() => commitWidth(DEFAULT_WIDTH)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") commitWidth(width + NUDGE);
          else if (e.key === "ArrowRight") commitWidth(width - NUDGE);
          else return;
          e.preventDefault();
        }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-shoal group-focus-visible:bg-shoal"
        />
      </div>

      {/*
       * Two rows rather than one. The panel is a phone-width bottom sheet as
       * often as it's a desktop side panel, and a title, a coordinate, a size
       * control and a close button competing for one line left the coordinate
       * reading "BA…". Close stays top-right where it's expected; the size
       * control takes the second line, which the coordinate wasn't filling.
       */}
      <header className="border-b border-hairline px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{title ?? "This spot"}</p>
            <p className="mt-1 font-display text-lg font-semibold leading-tight">
              {photos.length} {photos.length === 1 ? "photo" : "photos"}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <p className="coord min-w-0 flex-1 truncate">
            {centre?.lat !== undefined && centre?.lat !== null && centre.lng !== null
              ? `${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)}  ·  `
              : ""}
            {contributors.slice(0, 3).join(", ")}
            {contributors.length > 3 && ` +${contributors.length - 3}`}
          </p>
          <TileSizeControl tile={tile} className="shrink-0" />
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          if (scrollTop) scrollTop.current = e.currentTarget.scrollTop;
        }}
        className={`scroll-slim photo-grid photo-grid--panel overflow-y-scroll p-1 ${tile.sizeClass}`}
      >
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            ref={(el) => {
              if (el) tiles.current.set(photo.id, el);
              else tiles.current.delete(photo.id);
            }}
            type="button"
            onClick={() => onSelect(i)}
            className="photo-tile group relative overflow-hidden rounded-[2px] bg-hull-hi"
            aria-label={`Open photo by ${photo.ownerName}`}
          >
            <img
              src={photo.thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            {photo.mediaType === "video" && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-deep/70 text-[10px]">▶</span>
              </span>
            )}
            <span className="absolute bottom-1 left-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Avatar url={photo.ownerAvatarUrl} name={photo.ownerName} size={20} />
            </span>
            {/* Falsy for a kind that's been retired from the bar while its
                rows are still in the table. */}
            {reactionGlyph(photo.myReaction ?? "") && (
              <span className="absolute right-1 top-1 text-xs drop-shadow">
                {reactionGlyph(photo.myReaction!)}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Same table as the reaction bar, so a new emoji shows up here too. */
function reactionGlyph(kind: string) {
  return REACTIONS.find((r) => r.kind === kind)?.glyph ?? "";
}
