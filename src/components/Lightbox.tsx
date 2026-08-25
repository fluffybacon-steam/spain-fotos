"use client";
// src/components/Lightbox.tsx

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO } from "@/types";
import ReactionBar from "./ReactionBar";
import Avatar from "./Avatar";
import { nearestNamed, type NamedPlace } from "@/lib/places";
import Comments from "./Comments";
import { useViewer } from "./Viewer";
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
  freeloader?: boolean;
  onDeleted?: (photoId: string) => void;
  /**
   * Hand this photo back to the map so its owner can drop the pin again.
   * Optional: views without a map behind them (Browse) leave it off and the
   * control doesn't render.
   */
  onRepin?: (photoId: string) => void;
  /** Whether the photo on screen is in the caller's download selection. */
  selected?: boolean;
  /** Omit to hide the selection control entirely. */
  onToggleSelect?: (photoId: string) => void;
};

export default function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  onPhotoChange,
  namedPlaces = [],
  meId,
  freeloader,
  onDeleted,
  onRepin,
  selected = false,
  onToggleSelect,
}: Props) {
  const photo = photos[index];
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [showMeta, setShowMeta] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [favBusy, setFavBusy] = useState(false);
  const { canWrite } = useViewer();
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState("");
  const [savingTime, setSavingTime] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < photos.length) onIndexChange(next);
    },
    [index, photos.length, onIndexChange],
  );

  const photoId = photo?.id;

  const toggleSelect = useCallback(() => {
    if (photoId) onToggleSelect?.(photoId);
  }, [photoId, onToggleSelect]);

  /**
   * Stars the photo for this user alone. Optimistic like ReactionBar, and
   * rolled back to the object the server still believes in if the write fails —
   * a star that silently didn't save is worse than one that visibly refused,
   * because the whole point is finding the photo again later.
   */
  const toggleFavorite = useCallback(async () => {
    if (!photo || favBusy || !canWrite) return;
    const next = !photo.isFavorite;
    onPhotoChange({ ...photo, isFavorite: next });
    setFavBusy(true);
    try {
      const res = await fetch(`/api/photos/${photo.id}/favorite`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      onPhotoChange(photo);
    } finally {
      setFavBusy(false);
    }
  }, [photo, favBusy, canWrite, onPhotoChange]);

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
      else if (e.key === "s") toggleSelect();
      else if (e.key === "f") void toggleFavorite(); // no-ops for a guest
    }
    window.addEventListener("keydown", onKey);
    // Stop the page behind from scrolling while the lightbox owns the screen.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose, toggleSelect, toggleFavorite]);

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
    // An open editor must not carry a half-typed date onto the next photo.
    setEditingTime(false);
    setSavingTime(false);
    setTimeError(null);
  }, [photo?.id]);

  if (!photo) return null;

  const taken = photo.takenAt ? new Date(photo.takenAt) : null;
  const mine = Boolean(meId && photo.ownerId === meId);
  const placed = photo.lat !== null && photo.lng !== null;
  const place = placed
    ? nearestNamed({ lat: photo.lat!, lng: photo.lng! }, namedPlaces)
    : null;

  // Matches the server rule in /api/photos/location: the pin belongs to the
  // trip, not to the uploader, so anyone may correct one — placed or not, theirs
  // or not. Gated only on the caller wiring up a map to drop it on, which Browse
  // doesn't.
  // A guest has no write to make, so the pin isn't theirs to correct either.
  const canRepin = Boolean(onRepin) && canWrite;

  /**
   * Writes a corrected capture time. Open to everyone for the same reason the
   * pin is: a clock left on the wrong timezone, or a forwarded photo stamped
   * with the moment it was received, is usually spotted by someone other than
   * the person who uploaded it.
   */
  async function saveTime() {
    if (savingTime) return;
    const ms = Date.parse(timeDraft);
    if (Number.isNaN(ms)) {
      setTimeError("That isn't a date this app can read");
      return;
    }

    setSavingTime(true);
    setTimeError(null);
    const iso = new Date(ms).toISOString();

    try {
      const res = await fetch(`/api/photos/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takenAt: iso }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Couldn't save that time (${res.status})`);
      }
      // Only after the server has taken it. The gallery groups by date, so an
      // optimistic update here would visibly re-file the photo under a heading
      // it might have to leave again.
      onPhotoChange({ ...photo, takenAt: iso });
      setEditingTime(false);
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "Couldn't save that time");
    } finally {
      setSavingTime(false);
    }
  }

  function startEditingTime() {
    setTimeDraft(toDateTimeLocal(photo.takenAt));
    setTimeError(null);
    setEditingTime(true);
  }

  console.log("freeloader", freeloader);

  return (
    <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Photo viewer">
      {freeloader && (
        <div className="frogbutt" >
          <img src='/frogbutt.png'/>
        </div>
      )}
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

        {canWrite && (
        <button
          type="button"
          className="icon-btn"
          onClick={() => void toggleFavorite()}
          aria-label={photo.isFavorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={photo.isFavorite}
          title={photo.isFavorite ? "In your favorites (f)" : "Add to your favorites (f)"}
          style={photo.isFavorite ? { color: "var(--color-buoy)" } : undefined}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill={photo.isFavorite ? "currentColor" : "none"}
            aria-hidden="true"
          >
            <path
              d="M8 2.2l1.72 3.63 3.78.57-2.75 2.8.65 4.02L8 11.32l-3.4 1.9.65-4.02L2.5 6.4l3.78-.57L8 2.2Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        )}

        {onToggleSelect && (
          <button
            type="button"
            className="icon-btn"
            onClick={toggleSelect}
            aria-label={selected ? "Remove from selection" : "Add to selection"}
            aria-pressed={selected}
            style={
              selected
                ? { background: "var(--color-foam)", color: "var(--color-deep)" }
                : undefined
            }
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
              {selected && (
                <path
                  d="M5.2 8.2l2 2 3.6-4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </button>
        )}

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

        {canRepin && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => onRepin?.(photo.id)}
            aria-label={placed ? "Move this photo's pin on the map" : "Place this photo on the map"}
            title={placed ? "Move pin" : "Place on map"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 13.6s3.9-3.75 3.9-6.4a3.9 3.9 0 1 0-7.8 0c0 2.65 3.9 6.4 3.9 6.4Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="7.1" r="1.45" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M2.4 3.1h2.2M3.5 2v2.2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        {mine && canWrite && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setConfirmDeletes(true)}
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
              style={{ position: "absolute" }}
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
            <h3 className="mt-2 font-display text-xl font-bold">
              Delete this {photo.mediaType === "video" ? "video" : "foto"}?
            </h3>
            <p className="mt-2 text-sm text-haze">
              we all make mistakes. are you sure you want to deprive everyone of this foto?
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

                {editingTime ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <input
                      className="field"
                      type="datetime-local"
                      value={timeDraft}
                      autoFocus
                      disabled={savingTime}
                      style={{ width: "auto", flex: "1 1 12rem" }}
                      onChange={(e) => setTimeDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // The viewer listens for arrows and Escape globally.
                        e.stopPropagation();
                        if (e.key === "Enter") void saveTime();
                        if (e.key === "Escape") setEditingTime(false);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={savingTime}
                      onClick={() => void saveTime()}
                    >
                      {savingTime ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      disabled={savingTime}
                      onClick={() => setEditingTime(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="coord truncate">
                    {/* The date is the control. People notice a wrong timestamp
                        while reading it, so that's where the way to fix it goes
                        — for anyone who can write. For a guest it's just the
                        date, with no underline promising an edit. */}
                    {canWrite ? (
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foam"
                        onClick={startEditingTime}
                        title="Correct the date and time"
                      >
                        {taken
                          ? taken.toLocaleString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Date unknown"}
                      </button>
                    ) : taken ? (
                      taken.toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    ) : (
                      "Date unknown"
                    )}
                    {placed && (
                      <>
                        {"  ·  "}
                        {place ? place.name : `${photo.lat!.toFixed(5)}, ${photo.lng!.toFixed(5)}`}
                        {photo.locationSource === "manual" && " (placed by hand)"}
                      </>
                    )}
                    {/* Second way in, next to the coordinate people are actually
                        reading when they notice it's wrong. */}
                    {canRepin && (
                      <>
                        {"  ·  "}
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:text-foam"
                          onClick={() => onRepin?.(photo.id)}
                        >
                          {placed ? "Move" : "Place"}
                        </button>
                      </>
                    )}
                  </p>
                )}

                {timeError && (
                  <p className="mt-1 text-xs text-coral" role="alert">
                    {timeError}
                  </p>
                )}
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
/**
 * ISO string to the value an `<input type="datetime-local">` wants:
 * `YYYY-MM-DDTHH:mm`, in the viewer's own timezone and with no offset suffix.
 *
 * Built by hand rather than by slicing `toISOString()`, which is UTC — slicing
 * it shows a photo taken at 21:00 in Mallorca as 19:00, and saving would then
 * silently shift it by the offset every time anyone opened the editor.
 */
function toDateTimeLocal(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return toDateTimeLocal(null);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
