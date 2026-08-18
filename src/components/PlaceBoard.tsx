"use client";
// src/components/PlaceBoard.tsx

import { useCallback, useRef, useState } from "react";
import { PRESET_PLACES } from "@/lib/preset-places";

export type PlaceableItem = {
  /** Photo row id — what /api/photos/location updates. */
  id: string;
  /** Object URL of the thumbnail already generated during upload. */
  thumbUrl: string;
  /** Filename, used for the accessible label only. */
  label: string;
};

type Assignment = { placeName: string };

/** Pointer travel before a press becomes a drag rather than a tap. */
const DRAG_THRESHOLD = 8;

type PointerState = {
  pointerId: number;
  itemId: string;
  startX: number;
  startY: number;
  ids: string[];
  dragging: boolean;
};

/**
 * Files freshly uploaded photos into the trip's stops.
 *
 * Two ways in, because they suit different hands. Tapping is primary: tap any
 * number of prints, then tap a stop. Dragging is the same operation with one
 * gesture, and works with a mouse or a finger.
 *
 * Placement is per-photo and reversible until the page is left — nothing here
 * is a guess the app makes on the user's behalf, which is why every placement
 * lands as `locationSource: "manual"` and says so on the map.
 */
export default function PlaceBoard({
  items,
  onPlaced,
}: {
  items: PlaceableItem[];
  onPlaced?: (ids: string[]) => void;
}) {
  const [assigned, setAssigned] = useState<Record<string, Assignment>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ ids: string[]; x: number; y: number; thumbUrl: string } | null>(
    null,
  );
  const [overPlace, setOverPlace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pointer = useRef<PointerState | null>(null);
  const berths = useRef(new Map<string, HTMLButtonElement | null>());
  const rects = useRef<{ id: string; rect: DOMRect }[]>([]);

  const pending = items.filter((i) => !assigned[i.id]);
  const doneCount = items.length - pending.length;

  /** Measured once per drag: the berths can't move while a pointer is captured. */
  const measure = useCallback(() => {
    rects.current = [];
    berths.current.forEach((el, id) => {
      if (el) rects.current.push({ id, rect: el.getBoundingClientRect() });
    });
  }, []);

  const hitTest = useCallback((x: number, y: number): string | null => {
    for (const { id, rect } of rects.current) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return id;
    }
    return null;
  }, []);

  const assign = useCallback(
    async (placeId: string, ids: string[]) => {
      const place = PRESET_PLACES.find((p) => p.id === placeId);
      if (!place || !ids.length) return;

      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/photos/location", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, lat: place.lat, lng: place.lng }),
        });
        if (!res.ok) throw new Error(`Couldn't place these (${res.status})`);

        // Trust the server's list rather than the request: it decides what the
        // permission rule actually allowed.
        const { updated } = (await res.json()) as { updated: string[] };
        if (!updated?.length) throw new Error("Nothing was placed — try reloading");

        setAssigned((prev) => {
          const next = { ...prev };
          for (const id of updated) next[id] = { placeName: place.name };
          return next;
        });
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of updated) next.delete(id);
          return next;
        });
        onPlaced?.(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't place these");
      } finally {
        setBusy(false);
      }
    },
    [onPlaced],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Dragging a print that's part of a selection carries the whole selection.
    const ids = selected.has(id) ? [...selected] : [id];
    pointer.current = {
      pointerId: e.pointerId,
      itemId: id,
      startX: e.clientX,
      startY: e.clientY,
      ids,
      dragging: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const p = pointer.current;
    if (!p || p.pointerId !== e.pointerId) return;

    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return;
      p.dragging = true;
      measure();
      const item = items.find((i) => i.id === p.itemId);
      setDrag({ ids: p.ids, x: e.clientX, y: e.clientY, thumbUrl: item?.thumbUrl ?? "" });
      return;
    }

    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    setOverPlace(hitTest(e.clientX, e.clientY));
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const p = pointer.current;
    pointer.current = null;
    if (!p || p.pointerId !== e.pointerId) return;

    if (!p.dragging) {
      toggle(p.itemId);
      return;
    }

    const target = hitTest(e.clientX, e.clientY);
    setDrag(null);
    setOverPlace(null);
    if (target) void assign(target, p.ids);
  }

  function onPointerCancel() {
    pointer.current = null;
    setDrag(null);
    setOverPlace(null);
  }

  if (!items.length) return null;

  const selectionCount = selected.size;

  return (
    <section className="flex flex-col gap-4 rounded-[3px] border border-hairline bg-hull/50 p-4">
      <div>
        <p className="eyebrow">Sorting table</p>
        <h2 className="mt-1 font-display text-lg font-bold">
          {pending.length ? `${pending.length} to file` : "All filed"}
        </h2>
        <p className="coord mt-1.5 normal-case tracking-normal">
          {pending.length
            ? "Tap prints, then tap a stop. Or drag one across."
            : "Every photo from this batch is on the chart."}
        </p>
      </div>

      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2.5 py-1">
          {pending.map((item) => (
            <button
              key={item.id}
              type="button"
              className="print"
              aria-pressed={selected.has(item.id)}
              aria-label={`${item.label}${selected.has(item.id) ? " — selected" : ""}`}
              data-lifted={drag?.ids.includes(item.id) ? "true" : "false"}
              onPointerDown={(e) => onPointerDown(e, item.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(item.id);
                }
              }}
            >
              <img src={item.thumbUrl} alt="" />
            </button>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {PRESET_PLACES.map((place) => (
            <button
              key={place.id}
              type="button"
              className="berth"
              disabled={busy}
              data-over={overPlace === place.id ? "true" : "false"}
              ref={(el) => {
                berths.current.set(place.id, el);
              }}
              onClick={() => {
                if (selectionCount) void assign(place.id, [...selected]);
              }}
            >
              <span className="font-display text-sm font-bold leading-tight">{place.name}</span>
              <span className="coord">
                {Math.abs(place.lat).toFixed(3)}°{place.lat >= 0 ? "N" : "S"}{" "}
                {Math.abs(place.lng).toFixed(3)}°{place.lng >= 0 ? "E" : "W"}
              </span>
            </button>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <p className="coord normal-case tracking-normal">
          {busy
            ? "Placing…"
            : selectionCount
              ? `${selectionCount} selected — tap a stop above`
              : "Nothing selected"}
        </p>
      )}

      {error && <p className="text-sm text-coral">{error}</p>}

      {doneCount > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
          <p className="eyebrow">Filed</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {items
              .filter((i) => assigned[i.id])
              .map((i) => (
                <li key={i.id} className="coord normal-case tracking-normal">
                  <span className="text-shoal">{assigned[i.id].placeName}</span> · {i.label}
                </li>
              ))}
          </ul>
          <p className="coord mt-1">
            Placed by hand, so the map labels these as estimates. Move any of them from the map.
          </p>
        </div>
      )}

      {drag && (
        <div className="print print-ghost" style={{ left: drag.x, top: drag.y }}>
          <img src={drag.thumbUrl} alt="" />
          {drag.ids.length > 1 && <span className="cluster-count">{drag.ids.length}</span>}
        </div>
      )}
    </section>
  );
}
