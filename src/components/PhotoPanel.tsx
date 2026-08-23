"use client";
// src/components/PhotoPanel.tsx

import type { PhotoDTO } from "@/types";
import Avatar from "./Avatar";
import { REACTIONS } from "./ReactionBar";

/**
 * Sits over the map: a bottom sheet on phones, a side panel on wide screens.
 * The grid is deliberately dense — people scan a cluster for the one shot they
 * want, they don't read it.
 */
export default function PhotoPanel({
  photos,
  onSelect,
  onClose,
  title,
}: {
  photos: PhotoDTO[];
  onSelect: (index: number) => void;
  onClose: () => void;
  title?: string;
}) {
  if (!photos.length) return null;

  const centre = photos.find((p) => p.lat !== null && p.lng !== null);
  const contributors = Array.from(new Set(photos.map((p) => p.ownerName)));

  return (
    <section
      className="glass absolute inset-x-0 bottom-0 z-40 flex max-h-[72vh] flex-col rounded-t-[6px] sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[400px] sm:max-h-none sm:rounded-none sm:rounded-l-[6px]"
      aria-label={title ?? "Photos at this location"}
    >
      <header className="flex items-start gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{title ?? "This spot"}</p>
          <p className="mt-1 font-display text-lg font-semibold leading-tight">
            {photos.length} {photos.length === 1 ? "photo" : "photos"}
          </p>
          <p className="coord mt-1 truncate">
            {centre?.lat !== undefined && centre?.lat !== null && centre.lng !== null
              ? `${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)}  ·  `
              : ""}
            {contributors.slice(0, 3).join(", ")}
            {contributors.length > 3 && ` +${contributors.length - 3}`}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </header>

      <div className="scroll-slim grid grid-cols-3 gap-1 overflow-y-scroll p-1 sm:grid-cols-3" style={{ gridAutoRows: "minmax(100px, 250px)" }}>
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            style={{ width: "100%", height: "100%" }}
            type="button"
            onClick={() => onSelect(i)}
            className="group relative aspect-square overflow-hidden rounded-[2px] bg-hull-hi"
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
            {photo.myReaction && (
              <span className="absolute right-1 top-1 text-xs drop-shadow">
                {reactionGlyph(photo.myReaction)}
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
