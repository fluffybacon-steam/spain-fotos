// src/lib/places.ts
import type { PhotoDTO } from "@/types";

export type Point = { lat: number; lng: number };

export type NamedPlace = Point & { id: string; name: string };

/** A spot inferred from where photos already sit, not something anyone typed. */
export type DerivedPlace = Point & {
  key: string;
  count: number;
  thumbUrl: string;
  name: string | null;
  photoIds: string[];
  earliest: number | null;
  latest: number | null;
};

export type TimeSuggestion = {
  place: Point;
  /** Absolute gap in minutes between the two capture times. */
  minutesApart: number;
  neighbour: PhotoDTO;
};

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: Point, b: Point): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function isLocated(p: PhotoDTO): p is PhotoDTO & { lat: number; lng: number } {
  return p.lat !== null && p.lng !== null;
}

/**
 * Greedy single-pass clustering. Photos are sorted by capture time first, so a
 * cluster tends to correspond to one stop on the trip rather than an arbitrary
 * blob — two visits to the same beach a week apart still merge, which is what
 * you want when the output is a list of places to pick from.
 *
 * 180 m is roughly "the same cove or the same square" and comfortably wider
 * than consumer GPS error.
 */
export function clusterPhotos(photos: PhotoDTO[], radiusMeters = 180): DerivedPlace[] {
  const located = photos.filter(isLocated);
  const ordered = [...located].sort((a, b) => time(a) - time(b));

  const clusters: {
    lat: number;
    lng: number;
    members: (PhotoDTO & { lat: number; lng: number })[];
  }[] = [];

  for (const photo of ordered) {
    let best: (typeof clusters)[number] | null = null;
    let bestDistance = Infinity;

    for (const cluster of clusters) {
      const d = distanceMeters(cluster, photo);
      if (d < bestDistance) {
        bestDistance = d;
        best = cluster;
      }
    }

    if (best && bestDistance <= radiusMeters) {
      best.members.push(photo);
      // Running centroid, so the cluster drifts toward its true middle.
      const n = best.members.length;
      best.lat += (photo.lat - best.lat) / n;
      best.lng += (photo.lng - best.lng) / n;
    } else {
      clusters.push({ lat: photo.lat, lng: photo.lng, members: [photo] });
    }
  }

  return clusters
    .map((c) => {
      const times = c.members.map(time).filter((t) => t > 0);
      return {
        key: `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`,
        lat: c.lat,
        lng: c.lng,
        count: c.members.length,
        thumbUrl: c.members[0].thumbUrl,
        name: null,
        photoIds: c.members.map((m) => m.id),
        earliest: times.length ? Math.min(...times) : null,
        latest: times.length ? Math.max(...times) : null,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** Attach human names to derived clusters, matching by proximity. */
export function nameClusters(
  clusters: DerivedPlace[],
  named: NamedPlace[],
  maxMeters = 250,
): DerivedPlace[] {
  return clusters.map((cluster) => {
    let best: NamedPlace | null = null;
    let bestDistance = Infinity;
    for (const place of named) {
      const d = distanceMeters(cluster, place);
      if (d < bestDistance) {
        bestDistance = d;
        best = place;
      }
    }
    return { ...cluster, name: best && bestDistance <= maxMeters ? best.name : null };
  });
}

export function nearestNamed(
  point: Point,
  named: NamedPlace[],
  maxMeters = 250,
): NamedPlace | null {
  let best: NamedPlace | null = null;
  let bestDistance = Infinity;
  for (const place of named) {
    const d = distanceMeters(point, place);
    if (d < bestDistance) {
      bestDistance = d;
      best = place;
    }
  }
  return best && bestDistance <= maxMeters ? best : null;
}

/**
 * Guess where an unplaced photo belongs from when it was taken.
 *
 * This works because stripping GPS and stripping the timestamp are different
 * operations — a photo forwarded through a messaging app usually loses its
 * coordinates but keeps a usable time, and you were somewhere specific at that
 * moment. The gap is always surfaced to the caller rather than hidden, because
 * `takenAt` can fall back to file mtime, which for a forwarded image is when it
 * was received rather than shot. Thirty minutes keeps the suggestion honest.
 */
export function suggestByTime(
  photo: PhotoDTO,
  located: PhotoDTO[],
  maxMinutes = 30,
): TimeSuggestion | null {
  const target = time(photo);
  if (!target) return null;

  let best: PhotoDTO | null = null;
  let bestGap = Infinity;

  for (const candidate of located) {
    if (!isLocated(candidate)) continue;
    const t = time(candidate);
    if (!t) continue;
    const gap = Math.abs(t - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }

  if (!best || !isLocated(best)) return null;
  const minutesApart = bestGap / 60_000;
  if (minutesApart > maxMinutes) return null;

  return {
    place: { lat: best.lat, lng: best.lng },
    minutesApart,
    neighbour: best,
  };
}

export function formatGap(minutes: number): string {
  if (minutes < 1) return "less than a minute apart";
  if (minutes < 60) return `${Math.round(minutes)} min apart`;
  return `${(minutes / 60).toFixed(1)} h apart`;
}

function time(p: PhotoDTO): number {
  return p.takenAt ? Date.parse(p.takenAt) : 0;
}
