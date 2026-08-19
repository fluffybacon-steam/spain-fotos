"use client";
// src/components/PlaceBoard.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRESET_PLACES } from "@/lib/preset-places";

export type PlaceableItem = {
  /** Photo row id — what /api/photos/location updates. */
  id: string;
  /** Object URL of the thumbnail already generated during upload. */
  thumbUrl: string;
  /** Filename, used for the accessible label only. */
  label: string;
};

/**
 * What a print looked like at the moment it was filed.
 *
 * This is a copy, not a lookup into `items`, and that's the whole point. The
 * parent is free to drop a photo from `items` once it's placed — and when it
 * does, deriving the receipt from `items` loses every trace of the placement:
 * the "Filed" list comes back empty, and once the last print goes, the
 * `items.length` bail-out returns null before "All filed !" can ever render.
 * The confirmation has to outlive the input list.
 */
type FiledRecord = {
  id: string;
  label: string;
  thumbUrl: string;
  placeId: string;
  placeName: string;
};

/** Pointer travel before a press becomes a drag rather than a tap. */
const DRAG_THRESHOLD = 8;

/** How long the "filed to X" line stays up before falling back to idle copy. */
const RECEIPT_MS = 4000;

type PointerState = {
  pointerId: number;
  itemId: string;
  startX: number;
  startY: number;
  ids: string[];
  dragging: boolean;
};

type Tone = "idle" | "busy" | "ok" | "warn";

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
  const [filed, setFiled] = useState<FiledRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ ids: string[]; x: number; y: number; thumbUrl: string } | null>(
    null,
  );
  const [overPlace, setOverPlace] = useState<string | null>(null);
  const [working, setWorking] = useState<{ id: string; name: string; count: number } | null>(null);
  const [receipt, setReceipt] = useState<{ placeId: string; placeName: string; count: number } | null>(
    null,
  );
  const [nudge, setNudge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pointer = useRef<PointerState | null>(null);
  const berths = useRef(new Map<string, HTMLButtonElement | null>());
  const rects = useRef<{ id: string; rect: DOMRect }[]>([]);
  const receiptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (receiptTimer.current) clearTimeout(receiptTimer.current);
    },
    [],
  );

  const busy = working !== null;

  // Everything below is derived from `filed`, never from `items`, so the counts
  // hold up whether the parent keeps placed photos in the list or prunes them.
  const filedIds = useMemo(() => new Set(filed.map((f) => f.id)), [filed]);
  const pending = useMemo(() => items.filter((i) => !filedIds.has(i.id)), [items, filedIds]);
  const total = pending.length + filed.length;
  const stopCount = useMemo(() => new Set(filed.map((f) => f.placeId)).size, [filed]);
  const selectionCount = selected.size;
  const complete = total > 0 && pending.length === 0;

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

      if (receiptTimer.current) clearTimeout(receiptTimer.current);
      setNudge(false);
      setError(null);
      setReceipt(null);
      setWorking({ id: place.id, name: place.name, count: ids.length });

      try {
        const res = await fetch("/api/photos/location", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, lat: place.lat, lng: place.lng }),
        });
        if (!res.ok) throw new Error(`Couldn't file these (${res.status})`);

        // Trust the server's list rather than the request: it decides what the
        // permission rule actually allowed.
        const { updated } = (await res.json()) as { updated: string[] };
        if (!updated?.length) throw new Error("Nothing was filed — reload and try again");

        // Snapshot the prints now, while they're still in `items`.
        const byId = new Map(items.map((i) => [i.id, i]));
        const records: FiledRecord[] = updated.map((id) => {
          const item = byId.get(id);
          return {
            id,
            label: item?.label ?? id,
            thumbUrl: item?.thumbUrl ?? "",
            placeId: place.id,
            placeName: place.name,
          };
        });

        setFiled((prev) => {
          const seen = new Set(prev.map((f) => f.id));
          return [...prev, ...records.filter((r) => !seen.has(r.id))];
        });
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of updated) next.delete(id);
          return next;
        });
        setReceipt({ placeId: place.id, placeName: place.name, count: records.length });
        receiptTimer.current = setTimeout(() => setReceipt(null), RECEIPT_MS);

        // Last, so the parent can prune `items` without racing the snapshot above.
        onPlaced?.(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't file these");
      } finally {
        setWorking(null);
      }
    },
    [items, onPlaced],
  );

  function toggle(id: string) {
    setNudge(false);
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
      setNudge(false);
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

  // Only bail out when there is genuinely nothing to say — not the moment the
  // parent hands back an empty list because everything got filed.
  if (!items.length && !filed.length) return null;

  const status: { tone: Tone; text: string } = working
    ? { tone: "busy", text: `Filing ${working.count} to ${working.name}…` }
    : receipt
      ? {
          tone: "ok",
          text: `Filed ${receipt.count} ${receipt.count === 1 ? "foto" : "fotos"} to ${receipt.placeName}`,
        }
      : nudge
        ? { tone: "warn", text: "Select at least one foto first" }
        : complete
          ? {
              tone: "ok",
              text: `All ${total} filed across ${stopCount} ${stopCount === 1 ? "stop" : "stops"}`,
            }
          : selectionCount
            ? { tone: "idle", text: `${selectionCount} selected — now pick a stop` }
            : { tone: "idle", text: "Nothing selected" };

  return (
    <section
      className="place-board flex flex-col gap-4 rounded-[3px] border border-hairline bg-hull/50 p-4"
      data-complete={complete ? "true" : "false"}
      aria-busy={busy}
    >
      <div>
        <p className="eyebrow">Sorting table</p>
        <h2 className="mt-1 font-display text-lg font-bold">
          {pending.length ? `${pending.length} to file` : "All filed !"}
        </h2>
        {total > 0 && (
          <>
            <div className="filed-progress mt-2" aria-hidden="true">
              <span style={{ width: `${(filed.length / total) * 100}%` }} />
            </div>
            <p className="coord mt-1.5 normal-case tracking-normal">
              {filed.length} of {total} placed
            </p>
          </>
        )}
      </div>

      {pending.length > 0 && (
        <>
          <h3 className="mt-1 font-display text-lg pb-2">
            First: Select fotos you want to group to a location (click/tap)
          </h3>
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
        </>
      )}

      {pending.length > 0 && (
        <div className="place-picker" data-armed={selectionCount > 0 ? "true" : "false"}>
          <h3 className="mt-1 font-display text-lg pb-4">
            Second: Select a location to send your group of fotos to
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_PLACES.map((place) => (
              <button
                key={place.id}
                type="button"
                className="berth"
                disabled={busy && working?.id !== place.id}
                data-over={overPlace === place.id ? "true" : "false"}
                data-busy={working?.id === place.id ? "true" : "false"}
                data-just-filed={receipt?.placeId === place.id ? "true" : "false"}
                ref={(el) => {
                  berths.current.set(place.id, el);
                }}
                onClick={() => {
                  if (busy) return;
                  if (!selectionCount) {
                    setNudge(true);
                    return;
                  }
                  void assign(place.id, [...selected]);
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
        </div>
      )}

      {/* Outside the pending guard: the last placement's confirmation has to
          survive the moment the print row empties out. */}
      <p className="status-line coord normal-case tracking-normal" data-tone={status.tone} role="status">
        <span className="status-dot" aria-hidden="true" />
        {status.text}
      </p>

      {error && (
        <p className="text-sm text-coral" role="alert">
          {error}
        </p>
      )}

      {filed.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          <p className="eyebrow">Filed</p>
          <ul className="filed-strip">
            {filed.map((f) => (
              <li key={f.id} className="filed-chip">
                {f.thumbUrl && (
                  <img
                    src={f.thumbUrl}
                    alt=""
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <span className="coord normal-case tracking-normal">
                  <span className="text-shoal">{f.placeName}</span> · {f.label}
                </span>
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