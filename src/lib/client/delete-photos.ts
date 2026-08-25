// src/lib/client/delete-photos.ts

/** DELETE /api/photos caps a request at 200 ids, same as the location route. */
const MAX_IDS = 200;

export type DeleteOutcome = {
  /** Ids no longer in the trip — deleted now, or already absent. */
  removed: Set<string>;
  /** Rows belonging to someone else, with no admin rights to override. */
  refused: Set<string>;
  /** True if a chunk failed outright, so the caller can say the run was partial. */
  failed: boolean;
};

/**
 * Deletes many photos and reports what actually went.
 *
 * "Select all" on a full gallery is hundreds of ids, so this chunks — and a
 * refused or failed chunk doesn't abort the rest, because a selection spanning
 * several people is the normal case rather than a mistake.
 *
 * Already-absent ids count as removed: the caller asked for them to be gone and
 * they are, and leaving them on screen would strand a tile that reloads into
 * nothing.
 */
export async function deletePhotos(ids: string[]): Promise<DeleteOutcome> {
  const removed = new Set<string>();
  const refused = new Set<string>();
  let failed = false;

  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS);
    try {
      const res = await fetch("/api/photos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk }),
      });
      if (!res.ok) {
        failed = true;
        continue;
      }
      const body = (await res.json().catch(() => null)) as {
        deleted?: string[];
        alreadyGone?: string[];
        refused?: string[];
      } | null;

      for (const id of body?.deleted ?? []) removed.add(id);
      for (const id of body?.alreadyGone ?? []) removed.add(id);
      for (const id of body?.refused ?? []) refused.add(id);
    } catch {
      // A dropped connection is indistinguishable from a refusal as far as the
      // gallery is concerned: the tile stays until a reload proves otherwise.
      failed = true;
    }
  }

  return { removed, refused, failed };
}
