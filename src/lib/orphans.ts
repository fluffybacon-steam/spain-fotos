// src/lib/orphans.ts
/**
 * Reconciles bucket objects against photo rows.
 *
 * Lives in src/ rather than scripts/ because two callers need the same answer:
 * `npm run r2:audit` on the command line, and the rescue panel on /debug. Two
 * implementations of "is this object orphaned?" would drift, and the one that
 * drifted would either hide real orphans or offer to delete live photos.
 *
 * Pure — no bucket, no database. Callers fetch, this decides.
 */

export type BucketObject = { key: string; bytes: number; modified: Date | null };

export type Orphan = BucketObject & {
  /** photos/{owner}/{photoId}/ — lets three stray variants report as one photo. */
  group: string;
  /** False when the object is young enough to still be a live upload. */
  prunable: boolean;
};

export type MissingObject = { photoId: string; ownerId: string; key: string; variant: string };

export type PhotoRowKeys = {
  id: string;
  ownerId: string;
  originalKey: string;
  displayKey: string;
  thumbKey: string;
};

export type Audit = {
  orphans: Orphan[];
  missing: MissingObject[];
  /** Keys under neither photos/ nor avatars/. Reported, never touched. */
  unrecognised: BucketObject[];
  accounted: number;
  totalBytes: number;
};

export type Variant = "original" | "display" | "thumb";

export type OrphanGroup = {
  group: string;
  kind: "photo" | "avatar" | "unknown";
  /** Both are read straight out of the key path, which is why a stray object
   *  still knows who uploaded it and what id it was minted with. */
  ownerId: string | null;
  photoId: string | null;
  objects: Orphan[];
  bytes: number;
  /** Newest timestamp in the group. */
  modified: Date | null;
  keys: Record<Variant, string | null>;
  /** Every object in the group is old enough to delete. */
  prunable: boolean;
};

export function audit(
  objects: BucketObject[],
  rows: PhotoRowKeys[],
  avatarKeys: string[],
  opts: { minAgeMs: number; now: number },
): Audit {
  const referenced = new Set<string>();
  for (const row of rows) {
    referenced.add(row.originalKey);
    referenced.add(row.displayKey);
    referenced.add(row.thumbKey);
  }
  for (const key of avatarKeys) referenced.add(key);

  const present = new Set(objects.map((o) => o.key));

  const orphans: Orphan[] = [];
  const unrecognised: BucketObject[] = [];
  let accounted = 0;
  let totalBytes = 0;

  for (const obj of objects) {
    totalBytes += obj.bytes;

    if (referenced.has(obj.key)) {
      accounted += 1;
      continue;
    }

    // Anything outside the two prefixes this app writes is somebody else's —
    // report it so it's visible, but never offer to delete it.
    if (!obj.key.startsWith("photos/") && !obj.key.startsWith("avatars/")) {
      unrecognised.push(obj);
      continue;
    }

    const age = obj.modified ? opts.now - obj.modified.getTime() : Infinity;
    orphans.push({
      ...obj,
      group: groupOf(obj.key),
      // No LastModified means we can't prove it's young, so treat it as old
      // rather than stranding it forever — R2 always sends one in practice.
      prunable: age >= opts.minAgeMs,
    });
  }

  const missing: MissingObject[] = [];
  for (const row of rows) {
    for (const [variant, key] of [
      ["original", row.originalKey],
      ["display", row.displayKey],
      ["thumb", row.thumbKey],
    ] as const) {
      if (!present.has(key)) missing.push({ photoId: row.id, ownerId: row.ownerId, key, variant });
    }
  }

  return { orphans, missing, unrecognised, accounted, totalBytes };
}

/** photos/{owner}/{id}/original.jpg -> photos/{owner}/{id}/ ; avatars stand alone. */
export function groupOf(key: string): string {
  const parts = key.split("/");
  if (parts[0] === "photos" && parts.length >= 4) return parts.slice(0, 3).join("/") + "/";
  return key;
}

/** original.heic -> "original". Anything else isn't one of our three. */
export function variantOf(key: string): Variant | null {
  const stem = (key.split("/").pop() ?? "").split(".")[0];
  return stem === "original" || stem === "display" || stem === "thumb" ? stem : null;
}

/**
 * Folds loose objects into one entry per photo.
 *
 * The grouping is what makes the difference between "26 mystery files" and
 * "12 photos, 3 of them complete" — and the owner and photo id fall out of the
 * key path for free, so a rescued photo goes back to the person who uploaded
 * it rather than to whoever happened to run the tool.
 */
export function groupOrphans(orphans: Orphan[]): OrphanGroup[] {
  const byGroup = new Map<string, Orphan[]>();
  for (const o of orphans) byGroup.set(o.group, [...(byGroup.get(o.group) ?? []), o]);

  const groups: OrphanGroup[] = [];
  for (const [group, objects] of byGroup) {
    const parts = group.split("/");
    const isPhoto = parts[0] === "photos" && parts.length >= 4;
    const isAvatar = parts[0] === "avatars";

    const keys: Record<Variant, string | null> = { original: null, display: null, thumb: null };
    for (const o of objects) {
      const v = variantOf(o.key);
      if (v) keys[v] = o.key;
    }

    const times = objects.map((o) => o.modified?.getTime()).filter((t): t is number => !!t);

    groups.push({
      group,
      kind: isPhoto ? "photo" : isAvatar ? "avatar" : "unknown",
      ownerId: isPhoto ? parts[1] : null,
      photoId: isPhoto ? parts[2] : null,
      objects,
      bytes: objects.reduce((n, o) => n + o.bytes, 0),
      modified: times.length ? new Date(Math.max(...times)) : null,
      keys,
      prunable: objects.every((o) => o.prunable),
    });
  }

  // Newest first: the most recent casualty is the one someone is still looking
  // for, and the five-year-old stray can wait.
  return groups.sort((a, b) => (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0));
}

/**
 * What can still be done with a group.
 *
 * "full" — the original survived, so the rescued photo is the photo as shot.
 * "display-only" — the original PUT is the big one and the first to fail on a
 *   flaky connection; when it's gone the 2560px display copy is still a good
 *   photo and worth keeping, as long as nobody is told it's the original.
 * "none" — nothing renderable, or not one of ours.
 */
export function recoveryFor(g: OrphanGroup): "full" | "display-only" | "none" {
  if (g.kind !== "photo" || !g.ownerId || !g.photoId) return "none";
  if (g.keys.original && g.keys.display) return "full";
  if (g.keys.display) return "display-only";
  return "none";
}
