// src/lib/pin-handoff.ts

/**
 * Browse has no map behind it, so "drop a pin" is the one placement option that
 * has to cross a page boundary. The photo ids travel in sessionStorage rather
 * than the query string: a bulk selection is capped at 200 photos and 200 ids
 * of ~22 characters is well past what proxies and browsers carry reliably.
 *
 * A query flag still rides along, so the map only looks for a handoff when it
 * was sent one. Otherwise a stale list could ambush someone who simply opened
 * the map from a bookmark an hour later.
 */
const KEY = "cala:pin-targets";

/** Query flag the map watches for — `/?pin=1`. */
export const PIN_PARAM = "pin";

export function stashPinTargets(ids: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Private-mode Safari throws on write. Losing the handoff is survivable:
    // the map opens without pick mode and the selection is still on Browse.
  }
}

/** Reads and clears in one go — a handoff is single-use by definition. */
export function takePinTargets(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
