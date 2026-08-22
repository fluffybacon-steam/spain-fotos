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
  /**
   * Merge mode: tapping a pin or a cluster selects everything behind it rather
   * than opening it. The map is the only place you can see that two pins are
   * forty metres apart, so it's the only place the choice can be made.
   */
  mergeMode?: boolean;
  /** Photo ids currently selected for a merge. */
  mergeSelection?: Set<string>;
  onToggleGroup?: (photos: PhotoDTO[]) => void;
};

// Fallback view: the western Mediterranean, wide enough to hold mainland Spain
// and the Balearics together. Only used before any located photo exists.
const FALLBACK = { center: { lat: 39.6, lng: 2.6 }, zoom: 6 };

export default function MapCanvas({
  photos,
  onOpen,
  onCenterChange,
  pickMode,
  onPick,
  mergeMode,
  mergeSelection,
  onToggleGroup,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markerPhoto = useRef(new Map<google.maps.marker.AdvancedMarkerElement, PhotoDTO>());
  const clusterPhotos = useRef(new Map<HTMLElement, PhotoDTO[]>());
  const handlers = useRef({ onOpen, onPick, pickMode, mergeMode, mergeSelection, onToggleGroup });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");

  // Keep the latest callbacks reachable from listeners registered once.
  handlers.current = { onOpen, onPick, pickMode, mergeMode, mergeSelection, onToggleGroup };

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

      if (photo.mediaType === "video") {
        const play = document.createElement("span");
        play.className = "pin-play";
        play.textContent = "▶";
        el.appendChild(play);
      }

      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: photo.lat, lng: photo.lng },
        content: el,
        gmpClickable: true,
      });

      // What a tap means depends on the mode, and the mode is read at tap time
      // rather than captured here: these listeners are registered once per
      // photo and outlive several passes through merge mode.
      //
      // In pick mode a pin reports its own coordinate rather than opening.
      // Markers sit on top of the map and swallow the click, so tapping the one
      // spot you're aiming for used to be the one place the map didn't respond
      // — and "put it exactly where that photo is" is the commonest thing
      // anyone wants when merging pins by hand.
      const activate = () => {
        const h = handlers.current;
        if (h.pickMode) h.onPick?.(photo.lat, photo.lng);
        else if (h.mergeMode) h.onToggleGroup?.([photo]);
        else h.onOpen([photo], 0);
      };

      // AdvancedMarkerElement dispatches gmp-click rather than the legacy
      // 'click' event; keyboard activation needs its own listener.
      marker.addListener("gmp-click", activate);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });

      paintMergeState(el, [photo], mergeMode, mergeSelection);
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

        // A cluster element is built fresh on every zoom and pan, so its merge
        // state has to come from the ref rather than from a React render.
        paintMergeState(el, contents, handlers.current.mergeMode, handlers.current.mergeSelection);
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
        if (!contents?.length) return;
        const h = handlers.current;
        // A cluster's own position is the average of its members, which is the
        // honest answer to "there" when the stack covers several coordinates.
        if (h.pickMode) h.onPick?.(cluster.position.lat(), cluster.position.lng());
        else if (h.mergeMode) h.onToggleGroup?.(contents);
        else h.onOpen(contents, 0);
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

  /**
   * Repaints selection state without rebuilding any markers.
   *
   * Asking the clusterer to re-render would be the obvious route and doesn't
   * work: its render() only redraws when the algorithm reports the *clusters*
   * changed, and selecting a pin doesn't change any cluster. The elements are
   * still on screen, so they're written to directly.
   */
  useEffect(() => {
    for (const [marker, photo] of markerPhoto.current) {
      paintMergeState(marker.content as HTMLElement | null, [photo], mergeMode, mergeSelection);
    }
    for (const [el, contents] of clusterPhotos.current) {
      paintMergeState(el, contents, mergeMode, mergeSelection);
    }
  }, [mergeMode, mergeSelection, photos, status]);

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
          <p className="glass rounded-[3px] px-4 py-2 text-sm">
            Tap the map — or an existing pin to use its exact spot
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A pin or cluster counts as selected only when every photo behind it is — a
 * half-selected cluster shouldn't look like a decision that's been made.
 */
function paintMergeState(
  el: HTMLElement | null | undefined,
  contents: PhotoDTO[],
  mergeMode: boolean | undefined,
  selection: Set<string> | undefined,
) {
  if (!el) return;
  el.dataset.merge = mergeMode ? "true" : "false";
  const all =
    Boolean(mergeMode) &&
    contents.length > 0 &&
    contents.every((p) => selection?.has(p.id));
  el.dataset.selected = all ? "true" : "false";
}
