"use client";
// src/components/LocationSheet.tsx

import { useState } from "react";
import DestinationList from "./DestinationList";
import { isLocated, type NamedPlace } from "@/lib/places";
import type { PhotoDTO } from "@/types";

type Props = {
  /** The photos Browse has selected. Already chosen — this sheet only asks where. */
  targets: PhotoDTO[];
  located: PhotoDTO[];
  namedPlaces: NamedPlace[];
  /** Resolves false when the server moved nothing at all. */
  onApply: (lat: number, lng: number) => Promise<boolean>;
  /** Hand the selection to the map to drop a fresh pin. Omit to hide the option. */
  onDropPin?: () => void;
  onClose: () => void;
};

/**
 * Moves a whole bulk selection to one spot.
 *
 * Deliberately offers no free-text coordinate entry: every destination here is
 * a place the trip already has a name or a photo for, which is the difference
 * between correcting a pin and inventing one. Anything genuinely new goes
 * through the map, where you can see what you're pointing at.
 */
export default function LocationSheet({
  targets,
  located,
  namedPlaces,
  onApply,
  onDropPin,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placed = targets.filter(isLocated).length;

  async function apply(lat: number, lng: number) {
    if (busy || targets.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (await onApply(lat, lng)) onClose();
      else setError("Couldn't move those fotos. Try again in a moment.");
    } catch {
      setError("Couldn't move those fotos. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-deep/70"
      onClick={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Set location for selected fotos"
        onClick={(e) => e.stopPropagation()}
        className="glass absolute inset-x-0 bottom-0 flex max-h-[82vh] flex-col rounded-t-[6px] sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:max-h-none sm:rounded-none sm:rounded-l-[6px]"
      >
        <header className="flex items-start gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Selected fotos</p>
            <h2 className="mt-1 font-display text-lg font-semibold leading-tight">
              Set location for {targets.length} {targets.length === 1 ? "foto" : "fotos"}
            </h2>
            <p className="coord mt-1">
              {placed === 0
                ? "None of them are on the map yet"
                : placed === targets.length
                  ? `${placed === 1 ? "It's" : "All of them are"} already placed — this moves ${
                      targets.length === 1 ? "it" : "them"
                    }`
                  : `${placed} already placed · ${targets.length - placed} with no location`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </header>

        {/* The strip is the answer to "wait, which fotos did I tick?" — worth the
            space, and it stops a mis-click becoming a hundred wrong pins. */}
        <div className="scroll-slim flex gap-1 overflow-x-auto border-b border-hairline px-3 py-2">
          {targets.slice(0, 40).map((photo) => (
            <img
              key={photo.id}
              src={photo.thumbUrl}
              alt=""
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-[2px] object-cover"
            />
          ))}
          {targets.length > 40 && (
            <span className="coord grid h-10 shrink-0 place-items-center px-2">
              +{targets.length - 40}
            </span>
          )}
        </div>

        <div className="scroll-slim flex-1 overflow-y-auto">
          <DestinationList
            targets={targets}
            located={located}
            namedPlaces={namedPlaces}
            disabled={busy}
            onPick={(lat, lng) => void apply(lat, lng)}
          />
        </div>

        <footer className="border-t border-hairline p-3">
          {error && (
            <p className="mb-2 text-xs text-coral" role="alert">
              {error}
            </p>
          )}
          {onDropPin && (
            <button type="button" className="btn btn-quiet w-full" disabled={busy} onClick={onDropPin}>
              Drop a pin on the map instead
            </button>
          )}
          {busy && <p className="coord mt-2 animate-pulse text-center">Moving fotos</p>}
        </footer>
      </section>
    </div>
  );
}
