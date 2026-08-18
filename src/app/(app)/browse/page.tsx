"use client";
// src/app/(app)/browse/page.tsx

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import Lightbox from "@/components/Lightbox";
import { PRESET_PLACES } from "@/lib/preset-places";
import type { NamedPlace } from "@/lib/places";
import { formatDuration } from "@/lib/client/video";
import type { PersonDTO, PhotoDTO } from "@/types";

export default function BrowsePage() {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [namedPlaces, setNamedPlaces] = useState<NamedPlace[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [who, setWho] = useState<string | null>(null); // null = everyone
  const [index, setIndex] = useState<number | null>(null);

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
      }
      if (placeRes.ok) setNamedPlaces((await placeRes.json()).places);
      setLoading(false);
    })();
  }, []);

  const shown = useMemo(
    () => (who ? photos.filter((p) => p.ownerId === who) : photos),
    [photos, who],
  );

  const allNames = useMemo(() => [...PRESET_PLACES, ...namedPlaces], [namedPlaces]);

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
      list ? list.push(p) : map.set(key, [p]);
    }
    return [...map.entries()];
  }, [shown]);

  function removePhoto(photoId: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setIndex((i) => (i === null ? null : Math.max(0, i - 1)));
  }

  function updatePhoto(updated: PhotoDTO) {
    setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-3 py-5">
      <div className="mb-4 flex items-start justify-between gap-4 px-1">
        <div>
          <p className="eyebrow">
            {shown.length} {shown.length === 1 ? "photo" : "photos"}
            {who && ` by ${people.find((p) => p.id === who)?.name ?? "them"}`}
          </p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Gallery</h1>
        </div>
        <Link href="/" className="btn btn-quiet btn-sm">
          Map
        </Link>
      </div>

      {/* Who took it. Horizontally scrollable so it survives a big group. */}
      <div className="scroll-slim -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          className="reaction shrink-0"
          data-mine={who === null}
          onClick={() => setWho(null)}
        >
          <span>Everyone</span>
          <span>{photos.length}</span>
        </button>
        {people
          .filter((p) => p.photoCount > 0)
          .map((person) => (
            <button
              key={person.id}
              type="button"
              className="reaction shrink-0"
              data-mine={who === person.id}
              onClick={() => setWho(person.id === who ? null : person.id)}
            >
              <Avatar url={person.avatarUrl} name={person.name} size={18} />
              <span className="max-w-28 truncate">{person.name}</span>
              <span>{person.photoCount}</span>
            </button>
          ))}
      </div>

      {loading && <p className="coord animate-pulse px-1">Loading gallery</p>}

      {!loading && shown.length === 0 && (
        <div className="glass mt-10 rounded-[4px] p-6 text-center">
          <p className="eyebrow">Nothing to show</p>
          <h2 className="mt-2 font-display text-xl font-bold">
            {who ? "No photos from them yet" : "No photos uploaded yet"}
          </h2>
          <Link href="/upload" className="btn btn-primary mt-4">
            Add photos
          </Link>
        </div>
      )}

      {groups.map(([label, items]) => (
        <section key={label} className="mb-6">
          <h2 className="eyebrow sticky top-0 z-10 -mx-3 bg-deep/90 px-4 py-2 backdrop-blur-sm">
            {label} · {items.length}
          </h2>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-5 md:grid-cols-6">
            {items.map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setIndex(shown.indexOf(photo))}
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
                {!who && (
                  <span className="absolute bottom-1 left-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Avatar url={photo.ownerAvatarUrl} name={photo.ownerName} size={18} />
                  </span>
                )}
                <span className="absolute right-1 top-1 flex gap-0.5 text-[10px] drop-shadow">
                  {photo.myReaction && <span>{glyph(photo.myReaction)}</span>}
                  {photo.commentCount > 0 && <span>💬</span>}
                  {photo.mediaType === "video" && photo.durationMs && (
                    <span className="coord">{formatDuration(photo.durationMs)}</span>
                  )}
                  {photo.lat === null && <span title="No location"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M480-80Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q10 0 19.5.5T520-877v81q-10-2-20-3t-20-1q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186q122-112 181-203.5T720-552q0-2-.5-4t-.5-4h80q0 2 .5 4t.5 4q0 100-79.5 217.5T480-80Zm0-450Zm195-108 84-84 84 84 56-56-84-84 84-84-56-56-84 84-84-84-56 56 84 84-84 84 56 56ZM536.5-503.5Q560-527 560-560t-23.5-56.5Q513-640 480-640t-56.5 23.5Q400-593 400-560t23.5 56.5Q447-480 480-480t56.5-23.5Z"/></svg></span>}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {index !== null && shown[index] && (
        <Lightbox
          photos={shown}
          index={index}
          onIndexChange={setIndex}
          onPhotoChange={updatePhoto}
          meId={meId ?? undefined}
          onDeleted={removePhoto}
          namedPlaces={allNames}
          onClose={() => setIndex(null)}
        />
      )}
    </main>
  );
}

function glyph(kind: string) {
  return { heart: "❤️", up: "👍", meh: "😐", down: "👎", poo: "💩" }[kind] ?? "";
}
