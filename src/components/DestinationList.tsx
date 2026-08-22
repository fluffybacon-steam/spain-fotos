"use client";
// src/components/DestinationList.tsx

import { useMemo } from "react";
import type { PhotoDTO } from "@/types";
import {
  clusterPhotos,
  nameClusters,
  suggestByTime,
  formatGap,
  distanceMeters,
  type DerivedPlace,
  type NamedPlace,
} from "@/lib/places";
import { PRESET_PLACES } from "@/lib/preset-places";

type Props = {
  /** The photos about to be moved. Used for the single-photo time guess, and
   *  excluded from the derived spots so nothing offers its own current pin. */
  targets: PhotoDTO[];
  /** Every photo that has coordinates — the raw material for the spot list. */
  located: PhotoDTO[];
  namedPlaces: NamedPlace[];
  disabled?: boolean;
  onPick: (lat: number, lng: number) => void;
};

/**
 * The "where should this go" half of placing a photo: somewhere the trip has
 * already been, one of the planned stops, or the spot a neighbouring photo was
 * taken from a few minutes either side.
 *
 * Shared by PlacePicker (which picks the photos first) and LocationSheet (which
 * is handed a selection that Browse has already made), because the destinations
 * on offer shouldn't depend on which door you came in through.
 */
export default function DestinationList({
  targets,
  located,
  namedPlaces,
  disabled = false,
  onPick,
}: Props) {
  // A photo can't be its own destination. Without this, moving an already-placed
  // selection offers "here, where you already are" at the top of the list, and
  // the time guess proudly suggests the photo's own coordinates back to it.
  const elsewhere = useMemo(() => {
    const ids = new Set(targets.map((p) => p.id));
    return located.filter((p) => !ids.has(p.id));
  }, [targets, located]);

  const spots = useMemo<DerivedPlace[]>(
    () => nameClusters(clusterPhotos(elsewhere), namedPlaces),
    [elsewhere, namedPlaces],
  );

  // Only offer presets that aren't already represented by a real cluster —
  // otherwise "Sóller" appears twice, once with photos and once without.
  const presets = useMemo(
    () =>
      PRESET_PLACES.filter(
        (preset) => !spots.some((s) => distanceMeters(s, preset) <= (preset.radiusMeters ?? 250)),
      ),
    [spots],
  );

  // Only offer a time-based guess when exactly one photo is selected — the
  // suggestion is per-photo and averaging it across a selection would be a lie.
  const suggestion = useMemo(() => {
    if (targets.length !== 1) return null;
    const hit = suggestByTime(targets[0], elsewhere);
    if (!hit) return null;
    const spot = spots.find((s) => distanceMeters(s, hit.place) <= 200) ?? null;
    return { ...hit, spot };
  }, [targets, elsewhere, spots]);

  return (
    <>
      {/* Time-based guess ---------------------------------------------- */}
      {suggestion && (
        <div className="border-b border-hairline p-3">
          <p className="eyebrow mb-2">Best guess</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(suggestion.place.lat, suggestion.place.lng)}
            className="flex w-full items-center gap-3 rounded-[3px] border border-shoal/50 bg-shoal/10 p-2 text-left transition-colors hover:bg-shoal/20 disabled:opacity-40"
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
        <p className="eyebrow mb-2">{spots.length ? "Spots from the trip" : "No placed photos yet"}</p>

        <ul className="flex flex-col gap-1">
          {spots.map((spot) => (
            <li key={spot.key}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(spot.lat, spot.lng)}
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

      {/* Trip destinations ------------------------------------------- */}
      {presets.length > 0 && (
        <div className="border-t border-hairline p-3">
          <p className="eyebrow mb-2">Trip destinations</p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                onClick={() => onPick(preset.lat, preset.lng)}
                className="reaction disabled:opacity-40"
              >
                <span className="glyph">📍</span>
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
