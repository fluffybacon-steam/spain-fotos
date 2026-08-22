// src/lib/client/place-photos.ts

/**
 * PATCH /api/photos/location caps a request at 200 ids. Selections can exceed
 * that — "select all" on an unplaced list, a bulk selection in the gallery, or
 * a merge of two busy pins — and the route answers the whole request with a 400
 * when it does, so one photo too many used to mean nothing moved at all.
 */
const MAX_IDS = 200;

/**
 * Writes one coordinate onto many photos and reports which ones actually took.
 *
 * The route skips rows rather than failing the request, so the answer is a list
 * of written ids rather than a status — callers reconcile their optimistic
 * update against the returned set. A failed or refused chunk contributes
 * nothing to that set and doesn't abort the rest: partial success is the normal
 * case here, not an error.
 */
export async function writeLocation(
  ids: string[],
  lat: number,
  lng: number,
): Promise<Set<string>> {
  const wrote = new Set<string>();

  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS);
    try {
      const res = await fetch("/api/photos/location", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk, lat, lng }),
      });
      if (!res.ok) continue;
      const body = (await res.json().catch(() => null)) as { updated?: string[] } | null;
      for (const id of body?.updated ?? []) wrote.add(id);
    } catch {
      // Network failure — indistinguishable from a refusal as far as the
      // caller's rollback is concerned, and handled the same way.
    }
  }

  return wrote;
}
