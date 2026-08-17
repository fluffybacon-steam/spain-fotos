"use client";
// src/components/MapCanvas.tsx

import { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import { MarkerClusterer, type Cluster, type Renderer } from "@googlemaps/markerclusterer";
import type { PhotoDTO } from "@/types";

type Props = {
  photos: PhotoDTO[];
  onOpen: (photos: PhotoDTO[], startIndex: number) => void;
  onCenterChange?: (lat: number, lng: number) => void;
  /** When set, the next map click reports a coordinate instead of doing nothing. */
  pickMode?: boolean;
  onPick?: (lat: number, lng: number) => void;
};

// Fallback view: the western Mediterranean, wide enough to hold mainland Spain
// and the Balearics together. Only used before any located photo exists.
const FALLBACK = { center: { lat: 39.6, lng: 2.6 }, zoom: 6 };

export default function MapCanvas({ photos, onOpen, onCenterChange, pickMode, onPick }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markerPhoto = useRef(new Map<google.maps.marker.AdvancedMarkerElement, PhotoDTO>());
  const clusterPhotos = useRef(new Map<HTMLElement, PhotoDTO[]>());
  const handlers = useRef({ onOpen, onPick, pickMode });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");

  // Keep the latest callbacks reachable from listeners registered once.
  handlers.current = { onOpen, onPick, pickMode };

  useEffect(() => {
    let cancelled = false;

    const loader = new Loader({
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
      version: "weekly",
    });

    (async () => {
      try {
        const { Map } = (await loader.importLibrary("maps")) as google.maps.MapsLibrary;
        await loader.importLibrary("marker");
        if (cancelled || !hostRef.current) return;

        const map = new Map(hostRef.current, {
          ...FALLBACK,
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID!,
          // Matches the interface without needing a cloud-console style.
          colorScheme: "DARK" as google.maps.ColorScheme,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy", // one-finger pan; the map is the whole page
          clickableIcons: false,
        });

        mapRef.current = map;

        map.addListener("idle", () => {
          const c = map.getCenter();
          if (c && onCenterChange) onCenterChange(c.lat(), c.lng());
        });

        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (handlers.current.pickMode && e.latLng && handlers.current.onPick) {
            handlers.current.onPick(e.latLng.lat(), e.latLng.lng());
          }
        });

        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorText(err instanceof Error ? err.message : "Unknown error");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild markers whenever the located set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    const located = photos.filter(
      (p): p is PhotoDTO & { lat: number; lng: number } => p.lat !== null && p.lng !== null,
    );

    clustererRef.current?.clearMarkers();
    markerPhoto.current.clear();
    clusterPhotos.current.clear();

    const markers = located.map((photo) => {
      const el = document.createElement("div");
      el.className = "pin";
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.title = `${photo.ownerName}${photo.caption ? ` — ${photo.caption}` : ""}`;

      const img = document.createElement("img");
      img.src = photo.thumbUrl;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      el.appendChild(img);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: photo.lat, lng: photo.lng },
        content: el,
        gmpClickable: true,
      });

      // AdvancedMarkerElement dispatches gmp-click rather than the legacy
      // 'click' event; keyboard activation needs its own listener.
      marker.addListener("gmp-click", () => handlers.current.onOpen([photo], 0));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlers.current.onOpen([photo], 0);
        }
      });

      markerPhoto.current.set(marker, photo);
      return marker;
    });

    const renderer: Renderer = {
      render: (cluster: Cluster) => {
        const { count, position, markers: inCluster } = cluster;
        const contents = (inCluster ?? [])
          .map((m) => markerPhoto.current.get(m as google.maps.marker.AdvancedMarkerElement))
          .filter((p): p is PhotoDTO => Boolean(p));

        const el = document.createElement("div");
        el.className = "cluster";
        el.setAttribute("role", "button");
        el.tabIndex = 0;
        el.title = `${count} photos here`;

        // Three sheets of paper: two blanks behind, the newest photo on top.
        for (let i = 0; i < 3; i++) {
          const sheet = document.createElement("div");
          sheet.className = "cluster-sheet";
          if (i === 2 && contents[0]) {
            const img = document.createElement("img");
            img.src = contents[0].thumbUrl;
            img.alt = "";
            img.loading = "lazy";
            sheet.appendChild(img);
          }
          el.appendChild(sheet);
        }

        const badge = document.createElement("div");
        badge.className = "cluster-count";
        badge.textContent = String(count);
        el.appendChild(badge);

        clusterPhotos.current.set(el, contents);

        return new google.maps.marker.AdvancedMarkerElement({
          position,
          content: el,
          zIndex: 1000 + count,
          gmpClickable: true,
        });
      },
    };

    clustererRef.current?.setMap(null);
    clustererRef.current = new MarkerClusterer({
      map,
      markers,
      renderer,
      // Default behaviour is to zoom in. We want the grid instead — at a beach
      // where forty photos share one GPS reading, zooming never separates them.
      onClusterClick: (_event, cluster) => {
        const el = cluster.marker
          ? ((cluster.marker as google.maps.marker.AdvancedMarkerElement).content as HTMLElement)
          : null;
        const contents = el ? clusterPhotos.current.get(el) : undefined;
        if (contents?.length) handlers.current.onOpen(contents, 0);
      },
    });

    // Frame everything on first load, but don't yank the view on later updates.
    if (located.length && !map.get("cala:framed")) {
      const bounds = new google.maps.LatLngBounds();
      located.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
      map.fitBounds(bounds, 64);
      map.set("cala:framed", true);
    }
  }, [photos, status]);

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="h-full w-full" />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="eyebrow animate-pulse">Loading chart</p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="glass max-w-sm rounded-[3px] p-5">
            <p className="eyebrow mb-2">Map unavailable</p>
            <p className="text-sm text-foam">
              Google Maps didn&apos;t load. Check that the API key is set and that this domain is on
              its referrer allowlist.
            </p>
            {errorText && <p className="coord mt-3 break-all">{errorText}</p>}
          </div>
        </div>
      )}

      {pickMode && (
        <div className="pointer-events-none absolute inset-x-0 top-20 grid place-items-center">
          <p className="glass rounded-[3px] px-4 py-2 text-sm">Tap the map to place this photo</p>
        </div>
      )}
    </div>
  );
}
