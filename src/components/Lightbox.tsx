"use client";
// src/components/Lightbox.tsx

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO } from "@/types";
import ReactionBar from "./ReactionBar";
import Avatar from "./Avatar";
import { nearestNamed, type NamedPlace } from "@/lib/places";
import Comments from "./Comments";
import { formatDuration } from "@/lib/client/video";

type Props = {
  photos: PhotoDTO[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onPhotoChange: (photo: PhotoDTO) => void;
  namedPlaces?: NamedPlace[];
  /** Signed-in user id, so the owner sees a delete control. */
  meId?: string;
  onDeleted?: (photoId: string) => void;
};

export default function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  onPhotoChange,
  namedPlaces = [],
  meId,
  onDeleted,
}: Props) {
  const photo = photos[index];
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [showMeta, setShowMeta] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < photos.length) onIndexChange(next);
    },
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Arrow keys and Escape belong to whatever field has focus.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
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
      if (p && p.mediaType !== "video") {
        const img = new Image();
        img.src = p.displayUrl;
      }
    });
  }, [index, photos]);

  // Collapse the thread when moving to another photo, so the count and body
  // can never belong to the previous one.
  useEffect(() => {
    setShowComments(false);
    setCommentCount(null);
    setPlaybackFailed(false);
    setConfirmDelete(false);
  }, [photo?.id]);

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

        {meId && photo.ownerId === meId && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete this photo"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 4.4h10M6.4 4.4V2.9h3.2v1.5M4.4 4.4l.6 8.7h6l.6-8.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

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
        {photo.mediaType === "video" ? (
          playbackFailed ? (
            /* The browser can't decode this codec — almost always HEVC from an
               iPhone viewed on desktop Chrome. Show the poster and hand over to
               a download, which always works. */
            <div className="flex flex-col items-center gap-4 p-6 text-center">
              <img src={photo.thumbUrl} alt="" className="max-h-[50vh] rounded-[2px] opacity-70" />
              <div>
                <p className="text-sm font-semibold">This browser can&apos;t play this video</p>
                <p className="coord mt-1">
                  Usually HEVC recorded by an iPhone. Safari and iOS play it fine.
                </p>
              </div>
              <a href={photo.downloadUrl} className="btn btn-primary">
                Download to watch
              </a>
            </div>
          ) : (
            <video
              key={photo.id}
              src={photo.originalUrl}
              poster={photo.displayUrl}
              controls
              playsInline
              preload="metadata"
              onError={() => setPlaybackFailed(true)}
              className="max-h-full max-w-full rounded-[2px]"
            />
          )
        ) : (
          <img
            key={photo.id}
            src={photo.displayUrl}
            alt={photo.caption ?? `Photo by ${photo.ownerName}`}
            width={photo.width}
            height={photo.height}
          />
        )}

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

      {confirmDelete && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-deep/85 p-6">
          <div className="glass w-full max-w-sm rounded-[4px] p-5">
            <p className="eyebrow">This can&apos;t be undone</p>
            <h3 className="mt-2 font-display text-xl font-bold">
              Delete this {photo.mediaType === "video" ? "video" : "photo"}?
            </h3>
            <p className="mt-2 text-sm text-haze">
              It disappears for everyone, along with its comments and reactions. The stored files
              are removed too.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="btn btn-quiet flex-1"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Keep it
              </button>
              <button
                type="button"
                className="btn flex-1"
                style={{ background: "var(--color-coral)", color: "var(--color-deep)" }}
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  const res = await fetch(`/api/photos/${photo.id}`, { method: "DELETE" });
                  setDeleting(false);
                  if (res.ok) {
                    onDeleted?.(photo.id);
                    setConfirmDelete(false);
                  }
                }}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div className="flex flex-wrap items-center gap-1.5">
                <ReactionBar photo={photo} onChange={onPhotoChange} />
                <button
                  type="button"
                  className="reaction"
                  data-mine={showComments}
                  aria-expanded={showComments}
                  onClick={() => setShowComments((v) => !v)}
                >
                  <span className="glyph">💬</span>
                  <span>{commentCount ?? photo.commentCount}</span>
                </button>
              </div>
              <p className="coord">
                {photo.mediaType === "video"
                  ? `Video${photo.durationMs ? ` · ${formatDuration(photo.durationMs)}` : ""}`
                  : (photo.cameraModel ?? "Unknown camera")}{" "}
                · {(photo.originalBytes / 1_048_576).toFixed(1)} MB
              </p>
            </div>

            {showComments && (
              <div className="border-t border-hairline pt-3">
                <Comments
                  photoId={photo.id}
                  onCountChange={(n) => {
                    setCommentCount(n);
                    onPhotoChange({ ...photo, commentCount: n });
                  }}
                />
              </div>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
