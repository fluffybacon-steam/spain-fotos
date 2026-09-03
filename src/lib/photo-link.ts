// src/lib/photo-link.ts

/**
 * A link to one photo: `/browse?image_id=abc123`.
 *
 * Browse is the target rather than the map because it holds every photo
 * whether or not it has been placed, and it can open the viewer on one without
 * first having to reason about pins and clusters. A link from the map viewer
 * therefore points at Browse too — the point of a shared link is that the photo
 * opens, not that the sender's page is reproduced.
 */

export const IMAGE_PARAM = "image_id";

/** Absolute, because these are made to be pasted into a chat. */
export function photoLink(photoId: string, origin?: string): string {
  const base = origin ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${base}/browse?${IMAGE_PARAM}=${encodeURIComponent(photoId)}`;
}

export type ShareResult = "shared" | "copied" | "failed";

/**
 * Hands the link to whatever the device has. The share sheet is the right
 * thing on a phone, where the point is usually to send it to someone; the
 * clipboard is the fallback everywhere else.
 *
 * A cancelled share sheet reports "shared": the person saw their options and
 * chose none of them, which is not a failure to tell them about.
 */
export async function sharePhotoLink(photoId: string, title?: string): Promise<ShareResult> {
  const url = photoLink(photoId);

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ url, title: title ?? "Spain Fotos" });
      return "shared";
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "shared";
      // Anything else — a share sheet that refused the payload, a browser that
      // advertises the API without a target — falls through to the clipboard.
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
