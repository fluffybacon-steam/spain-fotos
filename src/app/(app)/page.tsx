"use client";
// src/app/(app)/page.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import MapCanvas from "@/components/MapCanvas";
import PhotoPanel from "@/components/PhotoPanel";
import PlacePicker from "@/components/PlacePicker";
import Lightbox from "@/components/Lightbox";
import TopBar from "@/components/TopBar";
import { isLocated, nearestNamed, type NamedPlace } from "@/lib/places";
import { PRESET_PLACES } from "@/lib/preset-places";
import type { PersonDTO, PhotoDTO } from "@/types";

export default function MapPage() {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [people, setPeople] = useState<PersonDTO[]>([]);
  const [namedPlaces, setNamedPlaces] = useState<NamedPlace[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(null);

  const [panel, setPanel] = useState<{ ids: string[]; title?: string } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [pinFor, setPinFor] = useState<string[] | null>(null);
  const [naming, setNaming] = useState<{ lat: number; lng: number; ids: string[] } | null>(null);
  const [placeName, setPlaceName] = useState("");

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

  const openPhotos = useCallback((selection: PhotoDTO[], startIndex: number) => {
    setPanel({ ids: selection.map((p) => p.id) });
    setLightboxIndex(selection.length === 1 ? startIndex : null);
  }, []);

  /** Optimistic bulk move, rolled back as a group if the write fails. */
  const applyLocation = useCallback(
    async (ids: string[], lat: number, lng: number) => {
      const before = photos.filter((p) => ids.includes(p.id));
      setPhotos((prev) =>
        prev.map((p) => (ids.includes(p.id) ? { ...p, lat, lng, locationSource: "manual" } : p)),
      );

      const res = await fetch("/api/photos/location", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, lat, lng }),
      });

      if (!res.ok) {
        setPhotos((prev) => prev.map((p) => before.find((b) => b.id === p.id) ?? p));
        return;
      }

      // Offer to name a spot only where there isn't one already nearby.
      if (!nearestNamed({ lat, lng }, allNames)) {
        setNaming({ lat, lng, ids });
        setPlaceName("");
      }
    },
    [photos, allNames],
  );

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
          const ids = pinFor;
          setPinFor(null);
          if (ids) void applyLocation(ids, lat, lng);
        }}
      />

      <TopBar
        centre={centre}
        people={people}
        unplacedCount={unplaced.length}
        onShowUnplaced={() => {
          setPanel(null);
          setPicking(true);
        }}
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

      {picking && unplaced.length > 0 && !pinFor && !naming && (
        <PlacePicker
          unplaced={unplaced}
          located={located}
          namedPlaces={allNames}
          onApply={applyLocation}
          onDropPin={(ids) => {
            setPinFor(ids);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}

      {panel && lightboxIndex === null && (
        <PhotoPanel
          photos={panelPhotos}
          title={panel.title}
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
          onClose={() => {
            setLightboxIndex(null);
            if (panelPhotos.length === 1) setPanel(null);
          }}
        />
      )}

      {pinFor && (
        <div className="glass absolute inset-x-2 bottom-2 z-40 flex items-center gap-3 rounded-[4px] px-3 py-2.5">
          <p className="flex-1 text-sm">
            Tap the map to place {pinFor.length} {pinFor.length === 1 ? "foto" : "fotos"}
          </p>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              setPinFor(null);
              setPicking(true);
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
