"use client";
// src/components/PlacePicker.tsx

import { useMemo, useState } from "react";
import type { PhotoDTO } from "@/types";
import {
  clusterPhotos,
  nameClusters,
  suggestByTime,
  formatGap,
  distanceMeters,
  isLocated,
  type DerivedPlace,
  type NamedPlace,
} from "@/lib/places";

type Props = {
  unplaced: PhotoDTO[];
  located: PhotoDTO[];
  namedPlaces: NamedPlace[];
  onApply: (ids: string[], lat: number, lng: number) => Promise<void>;
  onDropPin: (ids: string[]) => void;
  onClose: () => void;
};

export default function PlacePicker({
  unplaced,
  located,
  namedPlaces,
  onApply,
  onDropPin,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(unplaced.slice(0, 1).map((p) => p.id)));
  const [busy, setBusy] = useState(false);

  const spots = useMemo<DerivedPlace[]>(
    () => nameClusters(clusterPhotos(located), namedPlaces),
    [located, namedPlaces],
  );

  const selectedPhotos = unplaced.filter((p) => selected.has(p.id));

  // Only offer a time-based guess when exactly one photo is selected — the
  // suggestion is per-photo and averaging it across a selection would be a lie.
  const suggestion = useMemo(() => {
    if (selectedPhotos.length !== 1) return null;
    const hit = suggestByTime(selectedPhotos[0], located);
    if (!hit) return null;
    const spot = spots.find((s) => distanceMeters(s, hit.place) <= 200) ?? null;
    return { ...hit, spot };
  }, [selectedPhotos, located, spots]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function apply(lat: number, lng: number) {
    if (!selected.size || busy) return;
    setBusy(true);
    try {
      await onApply([...selected], lat, lng);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass absolute inset-x-0 bottom-0 z-40 flex max-h-[82vh] flex-col rounded-t-[6px] sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:max-h-none sm:rounded-none sm:rounded-l-[6px]">
      <header className="flex items-start gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Photos with no GPS</p>
          <h2 className="mt-1 font-display text-lg font-semibold leading-tight">
            Place {selected.size || "…"} of {unplaced.length}
          </h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </header>

      <div className="scroll-slim flex-1 overflow-y-auto">
        {/* Which photos ------------------------------------------------- */}
        <div className="border-b border-hairline p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Choose photos</p>
            <button
              type="button"
              className="coord underline underline-offset-2 hover:text-foam"
              onClick={() =>
                setSelected((prev) =>
                  prev.size === unplaced.length ? new Set() : new Set(unplaced.map((p) => p.id)),
                )
              }
            >
              {selected.size === unplaced.length ? "Clear" : "Select all"}
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1">
            {unplaced.map((photo) => {
              const on = selected.has(photo.id);
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => toggle(photo.id)}
                  aria-pressed={on}
                  aria-label={`${on ? "Deselect" : "Select"} photo by ${photo.ownerName}`}
                  className="relative aspect-square overflow-hidden rounded-[2px] bg-hull-hi"
                  style={{
                    outline: on ? "2px solid var(--color-shoal)" : "none",
                    outlineOffset: "-2px",
                    opacity: on ? 1 : 0.45,
                  }}
                >
                  <img src={photo.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Time-based guess ---------------------------------------------- */}
        {suggestion && (
          <div className="border-b border-hairline p-3">
            <p className="eyebrow mb-2">Best guess</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => apply(suggestion.place.lat, suggestion.place.lng)}
              className="flex w-full items-center gap-3 rounded-[3px] border border-shoal/50 bg-shoal/10 p-2 text-left transition-colors hover:bg-shoal/20"
            >
              <img
                src={suggestion.neighbour.thumbUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-[2px] object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {suggestion.spot?.name ??
                    `${suggestion.place.lat.toFixed(4)}, ${suggestion.place.lng.toFixed(4)}`}
                </p>
                <p className="coord truncate">
                  Taken {formatGap(suggestion.minutesApart)} from {suggestion.neighbour.ownerName}
                  &apos;s photo here
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Spots already on the map -------------------------------------- */}
        <div className="p-3">
          <p className="eyebrow mb-2">
            {spots.length ? "Spots from the trip" : "No placed photos yet"}
          </p>

          <ul className="flex flex-col gap-1">
            {spots.map((spot) => (
              <li key={spot.key}>
                <button
                  type="button"
                  disabled={busy || !selected.size}
                  onClick={() => apply(spot.lat, spot.lng)}
                  className="flex w-full items-center gap-3 rounded-[3px] border border-hairline bg-hull p-2 text-left transition-colors hover:border-shoal disabled:opacity-40"
                >
                  <img src={spot.thumbUrl} alt="" className="h-11 w-11 shrink-0 rounded-[2px] object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {spot.name ?? `${spot.lat.toFixed(4)}, ${spot.lng.toFixed(4)}`}
                    </p>
                    <p className="coord">
                      {spot.count} {spot.count === 1 ? "photo" : "photos"}
                      {spot.earliest &&
                        ` · ${new Date(spot.earliest).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })}`}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="border-t border-hairline p-3">
        <button
          type="button"
          className="btn btn-quiet w-full"
          disabled={!selected.size || busy}
          onClick={() => onDropPin([...selected])}
        >
          Drop a pin on the map instead
        </button>
      </footer>
    </section>
  );
}
