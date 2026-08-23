"use client";

// src/app/(app)/browse/page.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import Lightbox from "@/components/Lightbox";
import LocationSheet from "@/components/LocationSheet";
import { PRESET_PLACES } from "@/lib/preset-places";
import { isLocated, type NamedPlace } from "@/lib/places";
import { PIN_PARAM, stashPinTargets } from "@/lib/pin-handoff";
import { writeLocation } from "@/lib/client/place-photos";
import { formatDuration } from "@/lib/client/video";
import type { PersonDTO, PhotoDTO } from "@/types";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function formatBytes(bytes: number) {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.round(bytes / KB)} KB`;
}

/**
 * Browsers have no "save these N files" primitive, so click one anchor per file
 * and let the download manager stream each one. Chrome asks permission for the
 * first multi-file batch; the stagger keeps it from reading the run as a flood.
 */
async function downloadEach(
  items: PhotoDTO[],
  onProgress: (done: number) => void,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const a = document.createElement("a");
    a.href = p.downloadUrl;
    a.download = p.originalName ?? "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    onProgress(i + 1);
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
}

/**
 * Which slice of the gallery is on screen. One row of chips, one of them lit:
 * modelling it as a union rather than a couple of booleans is what stops
 * "Favorites" and "Bryan" from ever being on at the same time and quietly
 * meaning "Bryan's favorites", which is not a thing this app has.
 */
type View = { kind: "all" } | { kind: "favorites" } | { kind: "person"; id: string };

export default function BrowsePage() {
  const router = useRouter();
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [namedPlaces, setNamedPlaces] = useState<NamedPlace[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "all" });
  const [index, setIndex] = useState<number | null>(null);

  // Multi-select
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [downloaded, setDownloaded] = useState<number | null>(null); // null = idle
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    (async () => {
      const [photoRes, meRes, placeRes] = await Promise.all([
        fetch("/api/photos"),
        fetch("/api/me"),
        fetch("/api/places"),
      ]);
      if (photoRes.ok) setPhotos((await photoRes.json()).photos);
      if (meRes.ok) {
        const data = await meRes.json();
        setPeople(data.people);
        setMeId(data.me?.uid ?? null);
        console.log("me", data.me, "people", data.people);
      }
      if (placeRes.ok) setNamedPlaces((await placeRes.json()).places);
      setLoading(false);
    })();
  }, []);

  const shown = useMemo(() => {
    if (view.kind === "favorites") return photos.filter((p) => p.isFavorite);
    if (view.kind === "person") return photos.filter((p) => p.ownerId === view.id);
    return photos;
  }, [photos, view]);

  const allNames = useMemo(() => [...PRESET_PLACES, ...namedPlaces], [namedPlaces]);

  // Everything with coordinates, wherever it sits in the gallery: the spots on
  // offer when moving a selection are the trip's, not the current filter's.
  const located = useMemo(() => photos.filter(isLocated), [photos]);

  // Storage used, derived straight from the full photo list: one total for the
  // "Everyone" chip and a per-owner breakdown for the individual chips.
  const { totalMemory, memoryByOwner } = useMemo(() => {
    let total = 0;
    const byOwner = new Map<string, number>();
    for (const p of photos) {
      const bytes = p.originalBytes ?? 0;
      total += bytes;
      byOwner.set(p.ownerId, (byOwner.get(p.ownerId) ?? 0) + bytes);
    }
    return { totalMemory: formatBytes(total), memoryByOwner: byOwner };
  }, [photos]);

  // The favorites chip carries its own count and size for the same reason the
  // people chips do — it's the only clue about what's behind it.
  const { favoriteCount, favoriteMemory } = useMemo(() => {
    let n = 0;
    let bytes = 0;
    for (const p of photos) {
      if (!p.isFavorite) continue;
      n += 1;
      bytes += p.originalBytes ?? 0;
    }
    return { favoriteCount: n, favoriteMemory: formatBytes(bytes) };
  }, [photos]);

  // Photos arrive newest-first; group them under a date heading so scrolling a
  // long trip stays legible rather than becoming an undifferentiated wall.
  const groups = useMemo(() => {
    const map = new Map<string, PhotoDTO[]>();
    for (const p of shown) {
      const key = p.takenAt
        ? new Date(p.takenAt).toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "long",
          })
        : "Date unknown";
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    return [...map.entries()];
  }, [shown]);

  const toggleSelected = useCallback((photoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  // A deleted photo must not linger in the selection and resurrect itself in
  // the next download.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(photos.map((p) => p.id));
      const next = new Set<string>();
      for (const id of prev) if (live.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [photos]);

  const selectedPhotos = useMemo(
    () => photos.filter((p) => selected.has(p.id)),
    [photos, selected],
  );

  const selectedBytes = useMemo(
    () => selectedPhotos.reduce((n, p) => n + (p.originalBytes ?? 0), 0),
    [selectedPhotos],
  );

  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.id));
  const downloading = downloaded !== null;

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    setPlacing(false);
  }, []);

  // Escape leaves select mode, but only when the lightbox is closed, since it
  // owns Escape while it's up.
  useEffect(() => {
    if (!selectMode || index !== null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // The sheet is the topmost thing on screen while it's open, so it gets
      // Escape first — otherwise one keypress closes it *and* throws away the
      // selection behind it.
      if (placing) setPlacing(false);
      else exitSelectMode();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode, index, placing, exitSelectMode]);

  function toggleSelectAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) for (const p of shown) next.delete(p.id);
      else for (const p of shown) next.add(p.id);
      return next;
    });
  }

  function toggleSelectDay(items: PhotoDTO[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const every = items.every((p) => next.has(p.id));
      for (const p of items) {
        if (every) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  /**
   * Moves the whole selection to one point. Optimistic, then reconciled against
   * the ids the server says it actually wrote — the same contract the map page
   * honours, because /api/photos/location answers 200 with a short list rather
   * than failing when it skips a row.
   *
   * Resolves false on a total failure so the sheet can stay open and say so; a
   * partial write is not a failure, it just rolls the untouched photos back.
   */
  const applyLocation = useCallback(
    async (ids: string[], lat: number, lng: number): Promise<boolean> => {
      const before = photos.filter((p) => ids.includes(p.id));
      setPhotos((prev) =>
        prev.map((p) => (ids.includes(p.id) ? { ...p, lat, lng, locationSource: "manual" } : p)),
      );

      const wrote = await writeLocation(ids, lat, lng);
      if (wrote.size !== ids.length) {
        const restore = new Map(before.filter((p) => !wrote.has(p.id)).map((p) => [p.id, p]));
        setPhotos((prev) => prev.map((p) => restore.get(p.id) ?? p));
      }
      return wrote.size > 0;
    },
    [photos],
  );

  async function downloadSelected() {
    if (selectedPhotos.length === 0 || downloading) return;
    setDownloaded(0);
    try {
      await downloadEach(selectedPhotos, setDownloaded);
    } finally {
      setDownloaded(null);
    }
  }

  function removePhoto(photoId: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setIndex((i) => (i === null ? null : Math.max(0, i - 1)));
  }

  function updatePhoto(updated: PhotoDTO) {
    setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  console.log('lightbox freeloader test' , people.filter((person) => person.id == meId).some((person) => person.photoCount === 320))

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-3 py-5">
      <div className="mb-4 flex items-start justify-end gap-4 px-1">
        <div style={{ marginRight: "auto", display: "flex", gap: "1em", alignItems: "center" }}>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Gallery</h1>
          {photos.length > 0 && (
          <button
            type="button"
            style={{ background: 'floralwhite' }}
            className={selectMode ? "btn btn-primary btn-sm" : "btn btn-primary btn-sm"}
            aria-pressed={selectMode}
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          >
            {selectMode ? "Cancel Select" : "Bulk Select"}
          </button>
        )}
        </div>
        <Link href="/" className="btn btn-quiet btn-sm">
          Map
        </Link>
        <Link href="/upload" className="btn btn-primary btn-sm">
          Add fotos
        </Link>
      </div>

      {/* Who took it. Horizontally scrollable so it survives a big group. */}
      <div className="scroll-slim -mx-1 mb-4 flex gap-1.5 px-1 pb-1 overflow-x-scroll overflow-y-visible">
        <button
          type="button"
          className={
            view.kind === "all" && photos.length > 0 ? "reaction active shrink-0" : "reaction shrink-0"
          }
          data-mine={view.kind === "all"}
          onClick={() => setView({ kind: "all" })}
        >
          <span>Todo</span>
          <span>{photos.length}</span>
          <span className="memory">{totalMemory}</span>
        </button>
        {/* Shown even at zero: it's the only place the feature announces
            itself, and an empty list explains where the star lives. */}
        <button
          type="button"
          className={view.kind === "favorites" ? "reaction active shrink-0" : "reaction shrink-0"}
          data-mine={view.kind === "favorites"}
          onClick={() =>
            setView((v) => (v.kind === "favorites" ? { kind: "all" } : { kind: "favorites" }))
          }
          title="Only the fotos you starred. Everyone's list is their own."
        >
          <span className="glyph">⭐</span>
          <span>{favoriteCount}</span>
          <span className="memory">{favoriteMemory}</span>
        </button>
        {people
          .filter((p) => p.photoCount > 0)
          .map((person) => (
            <button
              key={person.id}
              type="button"
              className={
                view.kind === "person" && view.id === person.id
                  ? "reaction active shrink-0"
                  : "reaction shrink-0"
              }
              data-mine={view.kind === "person" && view.id === person.id}
              onClick={() =>
                setView((v) =>
                  v.kind === "person" && v.id === person.id
                    ? { kind: "all" }
                    : { kind: "person", id: person.id },
                )
              }
            >
              <Avatar url={person.avatarUrl} name={person.name} size={18} count={person.photoCount} />
              <span className="max-w-28 truncate">{person.name}</span>
              <span>{person.photoCount}</span>
              <span className="memory">{formatBytes(memoryByOwner.get(person.id) ?? 0)}</span>
            </button>
          ))}
      </div>

      {loading && <p className="coord animate-pulse px-1">Loading gallery</p>}

      {!loading && shown.length === 0 && (
        <div className="glass mt-10 rounded-[4px] p-6 text-center">
          <p className="eyebrow">Nothing to show</p>
          <h2 className="mt-2 font-display text-xl font-bold">
            {view.kind === "favorites"
              ? "Nothing starred yet"
              : view.kind === "person"
                ? "No photos from them yet"
                : "No photos uploaded yet"}
          </h2>
          {view.kind === "favorites" ? (
            <p className="coord mt-2">Open a foto and tap the star to keep it here</p>
          ) : (
            <Link href="/upload" className="btn btn-primary mt-4">
              Add fotos
            </Link>
          )}
        </div>
      )}

      {groups.map(([label, items]) => (
        <section key={label} className="mb-6">
          <h2 className="eyebrow sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-deep/90 px-4 py-2 backdrop-blur-sm">
            <span>
              {label} · {items.length}
            </span>
            {selectMode && (
              <button
                type="button"
                className="ml-auto text-[11px] underline underline-offset-2"
                onClick={() => toggleSelectDay(items)}
              >
                {items.every((p) => selected.has(p.id)) ? "Deselect day" : "Select day"}
              </button>
            )}
          </h2>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-5 md:grid-cols-6">
            {items.map((photo) => {
              const isSelected = selected.has(photo.id);
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() =>
                    selectMode ? toggleSelected(photo.id) : setIndex(shown.indexOf(photo))
                  }
                  aria-pressed={selectMode ? isSelected : undefined}
                  className={
                    "group relative aspect-square overflow-hidden rounded-[2px] bg-hull-hi" +
                    (selectMode && isSelected
                      ? " ring-2 ring-foam ring-offset-1 ring-offset-deep"
                      : "")
                  }
                  aria-label={
                    selectMode
                      ? `${isSelected ? "Deselect" : "Select"} photo by ${photo.ownerName}`
                      : `Open photo by ${photo.ownerName}`
                  }
                >
                  <img
                    src={photo.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={
                      "h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" +
                      (selectMode && !isSelected ? " opacity-60" : "")
                    }
                  />
                  {selectMode && (
                    <span
                      aria-hidden="true"
                      className={
                        "absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full text-[11px] leading-none " +
                        (isSelected
                          ? "bg-foam text-deep"
                          : "border border-foam/70 bg-deep/50 text-transparent")
                      }
                    >
                      ✓
                    </span>
                  )}
                  {photo.mediaType === "video" && (
                    <span className="pointer-events-none absolute inset-0 grid place-items-center">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-deep/70 text-[10px]">▶</span>
                    </span>
                  )}
                  {view.kind !== "person" && !selectMode && (
                    <span className="absolute bottom-1 left-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Avatar url={photo.ownerAvatarUrl} name={photo.ownerName} size={18} />
                    </span>
                  )}
                  <span className="absolute right-1 top-1 flex gap-0.5 text-[10px] drop-shadow">
                    {photo.isFavorite && <span title="In your favorites">⭐</span>}
                    {photo.myReaction && <span>{glyph(photo.myReaction)}</span>}
                    {photo.commentCount > 0 && <span>💬</span>}
                    {photo.mediaType === "video" && photo.durationMs && (
                      <span className="coord">{formatDuration(photo.durationMs)}</span>
                    )}
                    {photo.lat === null && (
                      <span title="No location">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          height="24px"
                          viewBox="0 -960 960 960"
                          width="24px"
                          fill="#e3e3e3"
                        >
                          <path d="M480-80Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q10 0 19.5.5T520-877v81q-10-2-20-3t-20-1q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186q122-112 181-203.5T720-552q0-2-.5-4t-.5-4h80q0 2 .5 4t.5 4q0 100-79.5 217.5T480-80Zm0-450Zm195-108 84-84 84 84 56-56-84-84 84-84-56-56-84 84-84-84-56 56 84 84-84 84 56 56ZM536.5-503.5Q560-527 560-560t-23.5-56.5Q513-640 480-640t-56.5 23.5Q400-593 400-560t23.5 56.5Q447-480 480-480t56.5-23.5Z" />
                        </svg>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {/* Selection tray. Sticks to the bottom so it stays reachable mid-scroll. */}
      {selectMode && (
        <div className="sticky bottom-3 z-20 mt-4">
          <div className="glass mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-[4px] px-3 py-2">
            <p className="coord mr-auto">
              {selected.size === 0
                ? "Tap fotos to select"
                : `${selected.size} selected · ${formatBytes(selectedBytes)}`}
            </p>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={toggleSelectAllShown}
              disabled={shown.length === 0 || downloading}
            >
              {allShownSelected ? "Clear" : "Select all"}
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setPlacing(true)}
              disabled={selected.size === 0 || downloading}
            >
              Set location
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={downloadSelected}
              disabled={selected.size === 0 || downloading}
            >
              {downloading
                ? `Downloading ${downloaded} / ${selectedPhotos.length}`
                : `Download${selected.size ? ` ${selected.size}` : ""}`}
            </button>
          </div>
        </div>
      )}

      {placing && selectedPhotos.length > 0 && (
        <LocationSheet
          targets={selectedPhotos}
          located={located}
          namedPlaces={allNames}
          onApply={(lat, lng) => applyLocation([...selected], lat, lng)}
          onDropPin={() => {
            // Browse has no map to tap, so the selection travels to the one
            // that does. It comes back placed, or not at all — either way this
            // page reloads its photos on the way in.
            stashPinTargets([...selected]);
            router.push(`/?${PIN_PARAM}=1`);
          }}
          onClose={() => setPlacing(false)}
        />
      )}

      {index !== null && shown[index] && (
        <Lightbox
          photos={shown}
          index={index}
          onIndexChange={setIndex}
          onPhotoChange={updatePhoto}
          meId={meId ?? undefined}
          freeloader={people.filter((person) => person.id == meId).some((person) => person.photoCount === 320) }
          onDeleted={removePhoto}
          namedPlaces={allNames}
          selected={selected.has(shown[index].id)}
          onToggleSelect={(id) => {
            setSelectMode(true);
            toggleSelected(id);
          }}
          onClose={() => setIndex(null)}
        />
      )}
    </main>
  );
}

function glyph(kind: string) {
  return { heart: "❤️", up: "👍", meh: "😐", down: "👎", poo: "💩" }[kind] ?? "";
}