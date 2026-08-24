"use client";
// src/components/PlacePicker.tsx

import { useState } from "react";
import type { PhotoDTO } from "@/types";
import DestinationList from "./DestinationList";
import type { NamedPlace } from "@/lib/places";

type Props = {
  unplaced: PhotoDTO[];
  located: PhotoDTO[];
  namedPlaces: NamedPlace[];
  /** Resolves when the write has settled; the result is the caller's business. */
  onApply: (ids: string[], lat: number, lng: number) => Promise<unknown>;
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

  const selectedPhotos = unplaced.filter((p) => selected.has(p.id));

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

          <div className="grid grid-cols-5 gap-1 unplaced">
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

        {/* Where it goes ------------------------------------------------ */}
        <DestinationList
          targets={selectedPhotos}
          located={located}
          namedPlaces={namedPlaces}
          disabled={busy || !selected.size}
          onPick={(lat, lng) => void apply(lat, lng)}
        />
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
