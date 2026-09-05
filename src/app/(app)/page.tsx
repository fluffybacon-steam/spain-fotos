"use client";
// src/app/(app)/page.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapCanvas from "@/components/MapCanvas";
import PhotoPanel from "@/components/PhotoPanel";
import PlacePicker from "@/components/PlacePicker";
import Lightbox from "@/components/Lightbox";
import MergeSheet from "@/components/MergeSheet";
import TopBar from "@/components/TopBar";
import { groupByPin, isLocated, nearestNamed, type NamedPlace } from "@/lib/places";
import { PRESET_PLACES } from "@/lib/preset-places";
import { PIN_PARAM, takePinTargets } from "@/lib/pin-handoff";
import { writeLocation } from "@/lib/client/place-photos";
import type { PersonDTO, PhotoDTO } from "@/types";

export default function MapPage() {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [namedPlaces, setNamedPlaces] = useState<NamedPlace[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(null);
  console.log("meId", meId);
  // `session` changes whenever a new set of photos is opened, so the panel
  // remounts rather than inheriting the last pin's scroll position.
  const [panel, setPanel] = useState<{ ids: string[]; title?: string; session: number } | null>(
    null,
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  // `mode` only affects wording and where Cancel returns to: "place" came from
  // the unplaced list and should fall back to it, "merge" came from the merge
  // sheet and should reopen it, "move" came from the viewer and has no list to
  // go back to.
  const [pinFor, setPinFor] = useState<{
    ids: string[];
    mode: "place" | "move" | "merge";
  } | null>(null);
  const [naming, setNaming] = useState<{ lat: number; lng: number; ids: string[] } | null>(null);
  const [placeName, setPlaceName] = useState("");
  // null = not merging. A Set rather than a list of pins because a pin isn't a
  // thing the app stores — it's whatever photos happen to share a coordinate,
  // and that regroups the moment a merge lands.
  const [mergeIds, setMergeIds] = useState<Set<string> | null>(null);
  const [choosingSpot, setChoosingSpot] = useState(false);

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

  /**
   * Browse sends a bulk selection here to be pinned by hand. Read straight off
   * `window.location` rather than through `useSearchParams`, which would drag
   * this whole client page under a Suspense boundary for one query flag.
   *
   * The flag is stripped immediately, so a reload — or a back-navigation an
   * hour later — doesn't drop the user into pick mode again.
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(PIN_PARAM) !== "1") return;
    url.searchParams.delete(PIN_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    const ids = takePinTargets();
    if (ids.length) setPinFor({ ids, mode: "move" });
  }, []);

  // Presets are always available for naming, even before anyone saves one.
  const allNames = useMemo(() => [...PRESET_PLACES, ...namedPlaces], [namedPlaces]);

  const located = useMemo(() => photos.filter(isLocated), [photos]);
  const unplaced = useMemo(() => photos.filter((p) => !isLocated(p)), [photos]);

  const panelPhotos = useMemo(() => {
    if (!panel) return [];
    const byId = new Map(photos.map((p) => [p.id, p]));
    return panel.ids.map((id) => byId.get(id)).filter((p): p is PhotoDTO => Boolean(p));
  }, [panel, photos]);

  const updatePhoto = useCallback((updated: PhotoDTO) => {
    setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  const removePhoto = useCallback((photoId: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setPanel((prev) => {
      if (!prev) return prev;
      const ids = prev.ids.filter((id) => id !== photoId);
      return ids.length ? { ...prev, ids } : null;
    });
    // Step back so the viewer never lands past the end of a shortened list.
    setLightboxIndex((i) => (i === null ? null : Math.max(0, i - 1)));
  }, []);

  /* ── The panel's place in its own grid ────────────────────────────────────
   *
   * The lightbox unmounts the panel while it's up, so the grid's scroll
   * position has to survive outside it. These refs are that handoff, and
   * clearing them is what decides how long it lives: across a viewer
   * round-trip, yes. Across closing the panel, or tapping a different pin, no —
   * that's a fresh spot, and it starts at the top.
   */
  const panelScroll = useRef(0);
  const panelFocus = useRef<string | null>(null);
  const panelSession = useRef(0);

  useEffect(() => {
    if (panel) return;
    panelScroll.current = 0;
    panelFocus.current = null;
  }, [panel]);

  const openPhotos = useCallback((selection: PhotoDTO[], startIndex: number) => {
    panelScroll.current = 0;
    panelFocus.current = null;
    setPanel({ ids: selection.map((p) => p.id), session: ++panelSession.current });
    setLightboxIndex(selection.length === 1 ? startIndex : null);
  }, []);

  /**
   * Optimistic bulk move, rolled back per id against what the server actually
   * wrote. Resolves false when nothing moved at all — a refusal is a normal
   * outcome here rather than an exception, and the callers that can show it
   * (the merge sheet) need to tell it apart from a partial success.
   */
  const applyLocation = useCallback(
    async (ids: string[], lat: number, lng: number): Promise<boolean> => {
      const before = photos.filter((p) => ids.includes(p.id));
      setPhotos((prev) =>
        prev.map((p) => (ids.includes(p.id) ? { ...p, lat, lng, locationSource: "manual" } : p)),
      );

      // Reconciled against the ids the server says it wrote, not the status:
      // the route skips rows rather than failing the request, so a refusal
      // comes back as a short list on a 200. Chunking lives in writeLocation,
      // since a merge of two busy pins can exceed the route's 200-id cap.
      const wrote = await writeLocation(ids, lat, lng);

      if (wrote.size !== ids.length) {
        const restore = new Map(before.filter((p) => !wrote.has(p.id)).map((p) => [p.id, p]));
        setPhotos((prev) => prev.map((p) => restore.get(p.id) ?? p));
      }
      if (!wrote.size) return false;

      // Offer to name a spot only where there isn't one already nearby. After a
      // merge this is the natural moment for it: the reason several pins were
      // one place is usually a name nobody had written down yet.
      if (!nearestNamed({ lat, lng }, allNames)) {
        setNaming({ lat, lng, ids: [...wrote] });
        setPlaceName("");
      }
      return true;
    },
    [photos, allNames],
  );

  // Two photos at one coordinate are one pin, and one pin has nothing to merge
  // with — the count that gates the control has to be of pins, not photos.
  const pinCount = useMemo(() => groupByPin(located).length, [located]);

  /** The distinct coordinates behind the current selection, largest pin first. */
  const mergeGroups = useMemo(
    () => (mergeIds ? groupByPin(photos.filter((p) => mergeIds.has(p.id))) : []),
    [mergeIds, photos],
  );

  const startMerge = useCallback(() => {
    // The panel and the viewer both sit on top of the map, and the next thing
    // this user has to do is see the pins.
    setPanel(null);
    setLightboxIndex(null);
    setPicking(false);
    setMergeIds(new Set());
  }, []);

  const cancelMerge = useCallback(() => {
    setMergeIds(null);
    setChoosingSpot(false);
  }, []);

  /**
   * Tapping a marker takes everything behind it, all or nothing. A cluster is
   * several pins the map happened to draw as one at this zoom, so partially
   * selecting it would mean selecting something the user can't currently see.
   */
  const toggleGroup = useCallback((group: PhotoDTO[]) => {
    setMergeIds((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      const all = group.every((p) => next.has(p.id));
      for (const p of group) {
        if (all) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }, []);

  const mergeInto = useCallback(
    async (lat: number, lng: number) => {
      const ids = [...(mergeIds ?? [])];
      if (!ids.length) return false;
      const ok = await applyLocation(ids, lat, lng);
      if (!ok) return false;
      setMergeIds(null);
      setChoosingSpot(false);
      return true;
    },
    [mergeIds, applyLocation],
  );

  // Escape backs out one layer at a time: the destination sheet first, then
  // merge mode itself. Only while no overlay of its own is up, since those
  // handle Escape themselves.
  useEffect(() => {
    if (!mergeIds || lightboxIndex !== null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (choosingSpot) setChoosingSpot(false);
      else cancelMerge();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mergeIds, choosingSpot, lightboxIndex, cancelMerge]);

  async function saveName() {
    if (!naming || !placeName.trim()) return setNaming(null);
    const res = await fetch("/api/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: placeName.trim(), lat: naming.lat, lng: naming.lng }),
    });
    if (res.ok) {
      const { place } = await res.json();
      setNamedPlaces((prev) => [...prev, place]);
    }
    setNaming(null);
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <MapCanvas
        photos={photos}
        onOpen={openPhotos}
        onCenterChange={(lat, lng) => setCentre({ lat, lng })}
        pickMode={Boolean(pinFor)}
        onPick={(lat, lng) => {
          const task = pinFor;
          setPinFor(null);
          if (!task) return;
          void applyLocation(task.ids, lat, lng);
          // A tapped point ends a merge as surely as picking one of the pins.
          if (task.mode === "merge") setMergeIds(null);
        }}
        mergeMode={Boolean(mergeIds) && !pinFor}
        mergeSelection={mergeIds ?? undefined}
        onToggleGroup={toggleGroup}
      />

      <TopBar
        centre={centre}
        people={people}
        unplacedCount={unplaced.length}
        onShowUnplaced={() => {
          setPanel(null);
          setPicking(true);
        }}
        // One pin can't be consolidated with anything.
        canMerge={meId === 'dI8w_MXZOUom'}
        merging={Boolean(mergeIds)}
        onToggleMerge={() => (mergeIds ? cancelMerge() : startMerge())}
      />

      {loading && (
        <div className="glass absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-[3px] px-4 py-2">
          <p className="coord animate-pulse">Reading the survey</p>
        </div>
      )}

      {!loading && photos.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-6">
          <div className="glass pointer-events-auto max-w-sm rounded-[4px] p-6 text-center">
            <p className="eyebrow">Nothing here yet</p>
            <h2 className="mt-2 font-display text-2xl font-bold">The chart is empty</h2>
            <p className="mt-2 text-sm text-haze">
              Add the first photos and they&apos;ll appear wherever your camera recorded them.
            </p>
            <a href="/upload" className="btn btn-primary mt-5 w-full">
              Add fotos
            </a>
          </div>
        </div>
      )}

      {picking && unplaced.length > 0 && !pinFor && !naming && !mergeIds && (
        <PlacePicker
          unplaced={unplaced}
          located={located}
          namedPlaces={allNames}
          onApply={applyLocation}
          onDropPin={(ids) => {
            setPinFor({ ids, mode: "place" });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}

      {panel && lightboxIndex === null && (
        <PhotoPanel
          key={panel.session}
          photos={panelPhotos}
          title={panel.title}
          scrollTop={panelScroll}
          focusId={panelFocus}
          onSelect={setLightboxIndex}
          onClose={() => setPanel(null)}
        />
      )}

      {panel && lightboxIndex !== null && panelPhotos[lightboxIndex] && (
        <Lightbox
          photos={panelPhotos}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onPhotoChange={updatePhoto}
          meId={meId ?? undefined}
          onDeleted={removePhoto}
          namedPlaces={allNames}
          onRepin={(id) => {
            // Clear both overlays: the viewer and the panel sit on top of the
            // map, and the next thing this user has to do is tap the map.
            setLightboxIndex(null);
            setPanel(null);
            setPinFor({ ids: [id], mode: "move" });
          }}
          onClose={() => {
            // The panel is about to remount; tell it which photo to come back
            // to, since arrowing through a busy pin can travel a long way from
            // the tile that was tapped.
            panelFocus.current = panelPhotos[lightboxIndex]?.id ?? null;
            setLightboxIndex(null);
            if (panelPhotos.length === 1) setPanel(null);
          }}
        />
      )}

      {/* Merge tray. Same slot as the pick prompt, and never both at once. */}
      {mergeIds && !pinFor && !naming && !choosingSpot && (
        <div className="glass absolute inset-x-2 bottom-2 z-40 flex flex-wrap items-center gap-3 rounded-[4px] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {mergeGroups.length === 0
                ? "Tap the pins that are really one place"
                : `${mergeGroups.length} ${mergeGroups.length === 1 ? "pin" : "pins"} · ${
                    mergeIds.size
                  } ${mergeIds.size === 1 ? "foto" : "fotos"}`}
            </p>
            <p className="coord">
              {mergeGroups.length < 2
                ? "Zoom in until they separate, then pick at least two"
                : "They'll all move to one spot you choose next"}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={mergeGroups.length < 2}
            onClick={() => setChoosingSpot(true)}
          >
            Choose spot
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={cancelMerge}>
            Cancel
          </button>
        </div>
      )}

      {choosingSpot && mergeGroups.length > 1 && (
        <MergeSheet
          groups={mergeGroups}
          namedPlaces={allNames}
          onMerge={mergeInto}
          onPickOnMap={() => {
            if (!mergeIds) return;
            setChoosingSpot(false);
            setPinFor({ ids: [...mergeIds], mode: "merge" });
          }}
          onClose={() => setChoosingSpot(false)}
        />
      )}

      {pinFor && (
        <div className="glass absolute inset-x-2 bottom-2 z-40 flex items-center gap-3 rounded-[4px] px-3 py-2.5">
          <p className="flex-1 text-sm">
            {pinFor.mode === "place"
              ? `Tap the map to place ${pinFor.ids.length} ${pinFor.ids.length === 1 ? "foto" : "fotos"}`
              : pinFor.mode === "merge"
                ? `Tap the map to merge ${pinFor.ids.length} fotos there`
                : `Tap the map to move ${
                    pinFor.ids.length === 1 ? "this foto" : `these ${pinFor.ids.length} fotos`
                  }`}
          </p>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              const mode = pinFor.mode;
              setPinFor(null);
              // Each mode goes back where it came from: the unplaced list for a
              // first placement, the destination sheet for a merge. A move
              // started from the viewer has nothing to go back to.
              if (mode === "place") setPicking(true);
              if (mode === "merge") setChoosingSpot(true);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Naming is offered, never required — skipping leaves plain coordinates. */}
      {naming && (
        <div className="glass absolute inset-x-2 bottom-2 z-50 rounded-[4px] p-3">
          <p className="eyebrow mb-2">Name this spot? Everyone will see it</p>
          <div className="flex gap-2">
            <input
              className="field flex-1"
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="Cala Millor"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") setNaming(null);
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void saveName()}>
              Save
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setNaming(null)}>
              Skip
            </button>
          </div>
        </div>
      )}
      <div style={{ position: 'fixed', left: '0px', bottom: '0px', zIndex: 1000, fontSize: '0.5rem', color: 'pink'}}>Version 0.03</div>
    </main>
  );
}
