"use client";
// src/components/Lightbox.tsx

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO } from "@/types";
import ReactionBar from "./ReactionBar";
import Avatar from "./Avatar";
import { nearestNamed, type NamedPlace } from "@/lib/places";

type Props = {
  photos: PhotoDTO[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onPhotoChange: (photo: PhotoDTO) => void;
  namedPlaces?: NamedPlace[];
};

export default function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  onPhotoChange,
  namedPlaces = [],
}: Props) {
  const photo = photos[index];
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [showMeta, setShowMeta] = useState(true);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < photos.length) onIndexChange(next);
    },
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "i") setShowMeta((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    // Stop the page behind from scrolling while the lightbox owns the screen.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  // Warm the neighbours so arrowing through feels instant.
  useEffect(() => {
    [index - 1, index + 1].forEach((i) => {
      const p = photos[i];
      if (p) {
        const img = new Image();
        img.src = p.displayUrl;
      }
    });
  }, [index, photos]);

  if (!photo) return null;

  const taken = photo.takenAt ? new Date(photo.takenAt) : null;
  const place =
    photo.lat !== null && photo.lng !== null
      ? nearestNamed({ lat: photo.lat, lng: photo.lng }, namedPlaces)
      : null;

  return (
    <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Photo viewer">
      {/* Header */}
      <header className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close viewer">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <p className="coord">
            {index + 1} / {photos.length}
          </p>
        </div>

        <button
          type="button"
          className="icon-btn"
          onClick={() => setShowMeta((v) => !v)}
          aria-label={showMeta ? "Hide details" : "Show details"}
          aria-pressed={showMeta}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
          </svg>
        </button>

        <a
          className="icon-btn"
          href={photo.downloadUrl}
          aria-label={`Download ${photo.originalName}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v8m0 0L4.8 6.8M8 10l3.2-3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M2.6 12.4h10.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </a>
      </header>

      {/* Stage */}
      <div
        className="lightbox-stage relative"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          if (!start) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          // Horizontal intent only, so a vertical scroll or pinch isn't hijacked.
          if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
          touchStart.current = null;
        }}
      >
        <img
          key={photo.id}
          src={photo.displayUrl}
          alt={photo.caption ?? `Photo by ${photo.ownerName}`}
          width={photo.width}
          height={photo.height}
        />

        {index > 0 && (
          <button
            type="button"
            className="icon-btn absolute left-3 top-1/2 -translate-y-1/2"
            onClick={() => go(-1)}
            aria-label="Previous photo"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {index < photos.length - 1 && (
          <button
            type="button"
            className="icon-btn absolute right-3 top-1/2 -translate-y-1/2"
            onClick={() => go(1)}
            aria-label="Next photo"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Attribution and survey data */}
      {showMeta && (
        <footer className="border-t border-hairline bg-hull/70 px-4 py-3 backdrop-blur-sm">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar url={photo.ownerAvatarUrl} name={photo.ownerName} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{photo.ownerName}</p>
                <p className="coord truncate">
                  {taken
                    ? taken.toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Date unknown"}
                  {photo.lat !== null && photo.lng !== null && (
                    <>
                      {"  ·  "}
                      {place ? place.name : `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`}
                      {photo.locationSource === "manual" && " (placed by hand)"}
                    </>
                  )}
                </p>
              </div>
            </div>

            {photo.caption && <p className="text-sm text-foam/90">{photo.caption}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <ReactionBar photo={photo} onChange={onPhotoChange} />
              <p className="coord">
                {photo.cameraModel ?? "Unknown camera"} · {(photo.originalBytes / 1_048_576).toFixed(1)} MB
              </p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
