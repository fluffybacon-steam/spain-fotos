// src/lib/preset-places.ts
import type { NamedPlace } from "./places";

/**
 * The stops on this trip, offered in the place picker so photos stripped of
 * GPS can be assigned without hunting the map.
 *
 * Radii are tuned so a photo is claimed by the right entry. The three Sóller
 * valley villages sit roughly 3 km apart, so their radii stay well under half
 * that — otherwise Fornalutx photos would silently label themselves "Sóller".
 * Cities get a wide radius because a photo anywhere in Bilbao really is Bilbao.
 * Measured: Sóller to Fornalutx is 1.88 km, so 850 m each leaves a clean gap.
 */
export const PRESET_PLACES: NamedPlace[] = [
  { id: "preset-barcelona", name: "Barcelona", lat: 41.3874, lng: 2.1686, radiusMeters: 6000 },
  { id: "preset-port-soller", name: "Port de Sóller", lat: 39.7955, lng: 2.6931, radiusMeters: 1200 },
  { id: "preset-soller", name: "Sóller", lat: 39.7667, lng: 2.7156, radiusMeters: 850 },
  { id: "preset-fornalutx", name: "Fornalutx", lat: 39.7803, lng: 2.7286, radiusMeters: 850 },
  { id: "preset-bilbao", name: "Bilbao", lat: 43.263, lng: -2.935, radiusMeters: 6000 },
  { id: "preset-san-sebastian", name: "San Sebastián", lat: 43.3183, lng: -1.9812, radiusMeters: 5000 },
  // A day on the water isn't a point, it's a drift. The centre is the anchorage
  // off the south coast (39°19'53.6"N 2°56'10.0"E) and the radius is wide enough
  // to claim anything shot at sea that day. The nearest other stop is Sóller,
  // over 50 km away on the north coast, so a radius this generous can't steal a
  // photo from another entry.
  { id: "preset-boat", name: "Boat", lat: 39.331556, lng: 2.936111, radiusMeters: 15000 },
];
