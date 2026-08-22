"use client";
// src/components/MergeSheet.tsx

import { useState } from "react";
import {
  distanceMeters,
  formatDistance,
  maxSpreadMeters,
  midpoint,
  nearestNamed,
  type NamedPlace,
  type PinGroup,
} from "@/lib/places";

type Props = {
  /** The pins being consolidated, largest first. */
  groups: PinGroup[];
  namedPlaces: NamedPlace[];
  /** Resolves false when the server moved nothing at all. */
  onMerge: (lat: number, lng: number) => Promise<boolean>;
  /** Leave the sheet and let the user tap a fresh point on the map instead. */
  onPickOnMap: () => void;
  onClose: () => void;
};

/**
 * Picks the surviving coordinate for a set of pins.
 *
 * Merging is only ever a write of one lat/lng onto every photo behind the
 * selected pins — there's no merge record, no parent pin, nothing to undo
 * later. That's why the destination is chosen explicitly rather than computed:
 * the photos keep their own identity and the map redraws with one pin because
 * the coordinates now match, not because anything is grouping them.
 */
export default function MergeSheet({ groups, namedPlaces, onMerge, onPickOnMap, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoCount = groups.reduce((n, g) => n + g.photos.length, 0);
  const spread = maxSpreadMeters(groups);
  const centre = midpoint(groups);
  const biggest = groups[0];

  async function merge(lat: number, lng: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // On success this sheet is unmounted by the page, so `busy` is left set
      // deliberately — clearing it would flash the buttons back to life for a
      // frame on the way out.
      if (await onMerge(lat, lng)) return;
      setError("Couldn't move those fotos. Try again in a moment.");
    } catch {
      setError("Couldn't move those fotos. Try again in a moment.");
    }
    setBusy(false);
  }

  return (
    <div className="absolute inset-0 z-40 bg-deep/70" onClick={onClose} role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Merge pins"
        onClick={(e) => e.stopPropagation()}
        className="glass absolute inset-x-0 bottom-0 flex max-h-[82vh] flex-col rounded-t-[6px] sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:max-h-none sm:rounded-none sm:rounded-l-[6px]"
      >
        <header className="flex items-start gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Merge {groups.length} pins</p>
            <h2 className="mt-1 font-display text-lg font-semibold leading-tight">
              Which spot survives?
            </h2>
            <p className="coord mt-1">
              {photoCount} {photoCount === 1 ? "foto" : "fotos"} · furthest apart{" "}
              {formatDistance(spread)}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </header>

        <div className="scroll-slim flex-1 overflow-y-auto">
          <div className="p-3">
            <p className="eyebrow mb-2">Keep one of these pins</p>
            <ul className="flex flex-col gap-1">
              {groups.map((group) => {
                const named = nearestNamed(group, namedPlaces);
                const away = group === biggest ? 0 : distanceMeters(group, biggest);
                return (
                  <li key={group.key}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void merge(group.lat, group.lng)}
                      className="flex w-full items-center gap-3 rounded-[3px] border border-hairline bg-hull p-2 text-left transition-colors hover:border-shoal disabled:opacity-40"
                    >
                      <img
                        src={group.photos[0].thumbUrl}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-[2px] object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {named ? named.name : `${group.lat.toFixed(5)}, ${group.lng.toFixed(5)}`}
                        </p>
                        <p className="coord">
                          {group.photos.length} {group.photos.length === 1 ? "foto" : "fotos"}
                          {/* Distance from the busiest pin is the number that
                              tells you whether these really are one place. */}
                          {away > 0 && ` · ${formatDistance(away)} from the largest`}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {centre && groups.length > 1 && (
            <div className="border-t border-hairline p-3">
              <p className="eyebrow mb-2">Or split the difference</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void merge(centre.lat, centre.lng)}
                className="flex w-full items-center gap-3 rounded-[3px] border border-shoal/50 bg-shoal/10 p-2 text-left transition-colors hover:bg-shoal/20 disabled:opacity-40"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[2px] bg-hull-hi text-lg">
                  ⌖
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">Midpoint of the pins</p>
                  <p className="coord truncate">
                    {centre.lat.toFixed(5)}, {centre.lng.toFixed(5)} · one vote per pin
                  </p>
                </div>
              </button>
            </div>
          )}
        </div>

        <footer className="border-t border-hairline p-3">
          {error && (
            <p className="mb-2 text-xs text-coral" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-quiet w-full" disabled={busy} onClick={onPickOnMap}>
            Tap a different point on the map
          </button>
          {busy && <p className="coord mt-2 animate-pulse text-center">Merging</p>}
        </footer>
      </section>
    </div>
  );
}
