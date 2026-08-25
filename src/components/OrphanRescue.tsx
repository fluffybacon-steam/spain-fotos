"use client";
// src/components/OrphanRescue.tsx

import { useCallback, useEffect, useState } from "react";
import PlaceBoard, { type PlaceableItem } from "@/components/PlaceBoard";

type Orphan = {
  group: string;
  photoId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  bytes: number;
  modified: string | null;
  variants: { original: boolean; display: boolean; thumb: boolean };
  video: boolean;
  recovery: "full" | "display-only" | "none";
  prunable: boolean;
  previewUrl: string | null;
};

type Recovered = { photoId: string; thumbUrl: string; label: string; placed: boolean };

type Status =
  | { state: "loading" }
  | { state: "forbidden" }
  | { state: "error"; message: string }
  | { state: "ready"; orphans: Orphan[]; missingCount: number; totalBytes: number };

function size(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Local-time value for a datetime-local input, or "" when there's nothing. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Triage for uploads whose bytes reached the bucket but whose row never got
 * written — a refused duplicate, a closed tab, a connection that died between
 * the last PUT and the save.
 *
 * Recovering puts the photo back into the trip proper, which is what makes the
 * rest of the app work on it: the pin board below is the same one the uploader
 * uses, and the date field writes through the same PATCH the map does. Nothing
 * here is a second, parallel way to own a photo.
 */
export default function OrphanRescue() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [recovered, setRecovered] = useState<Recovered[]>([]);

  const load = useCallback(async () => {
    setStatus({ state: "loading" });
    try {
      const res = await fetch("/api/orphans");
      if (res.status === 403) return setStatus({ state: "forbidden" });
      if (!res.ok) throw new Error(`Couldn't read the bucket (${res.status})`);
      const data = await res.json();
      setStatus({
        state: "ready",
        orphans: data.orphans,
        missingCount: data.missingCount,
        totalBytes: data.totalBytes,
      });
      setDates((prev) => {
        const next = { ...prev };
        for (const o of data.orphans as Orphan[]) {
          if (!(o.group in next)) next[o.group] = toLocalInput(o.modified);
        }
        return next;
      });
    } catch (err) {
      setStatus({ state: "error", message: err instanceof Error ? err.message : "Failed" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function drop(group: string) {
    setStatus((s) =>
      s.state === "ready" ? { ...s, orphans: s.orphans.filter((o) => o.group !== group) } : s,
    );
  }

  async function recover(o: Orphan) {
    setBusy(o.group);
    setNotes((n) => ({ ...n, [o.group]: "" }));
    try {
      const local = dates[o.group];
      const res = await fetch("/api/orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group: o.group,
          takenAt: local ? new Date(local).toISOString() : null,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        // Not a failure. The index refusing the row is the answer: these bytes
        // are a copy of something already saved.
        setNotes((n) => ({ ...n, [o.group]: data.error ?? "Already in the trip" }));
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `Recovery failed (${res.status})`);

      setRecovered((prev) => [
        ...prev,
        {
          photoId: data.photoId,
          thumbUrl: data.thumbUrl,
          label: o.ownerName ? `${o.ownerName} · ${data.photoId}` : data.photoId,
          placed: data.placed,
        },
      ]);
      drop(o.group);
    } catch (err) {
      setNotes((n) => ({
        ...n,
        [o.group]: err instanceof Error ? err.message : "Recovery failed",
      }));
    } finally {
      setBusy(null);
    }
  }

  async function discard(o: Orphan) {
    setBusy(o.group);
    try {
      const res = await fetch("/api/orphans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: o.group }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't discard (${res.status})`);
      drop(o.group);
    } catch (err) {
      setNotes((n) => ({
        ...n,
        [o.group]: err instanceof Error ? err.message : "Couldn't discard",
      }));
    } finally {
      setBusy(null);
    }
  }

  if (status.state === "forbidden") return null;

  if (status.state === "loading") {
    return <p className="coord">Scanning the bucket…</p>;
  }

  if (status.state === "error") {
    return (
      <p className="coord text-coral">
        {status.message}{" "}
        <button type="button" className="underline underline-offset-2" onClick={() => void load()}>
          retry
        </button>
      </p>
    );
  }

  // Only unplaced rescues need the board; one that came back with EXIF
  // coordinates is already on the map.
  const placeable: PlaceableItem[] = recovered
    .filter((r) => !r.placed)
    .map((r) => ({ id: r.photoId, thumbUrl: r.thumbUrl, label: r.label }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="coord">
          {status.orphans.length
            ? `${status.orphans.length} stranded · ${size(status.totalBytes)}`
            : "Nothing stranded — every object has a row."}
          {status.missingCount > 0 && ` · ${status.missingCount} broken references`}
        </p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>
          Rescan
        </button>
      </div>

      {status.missingCount > 0 && (
        <p className="coord text-coral">
          {status.missingCount} object{status.missingCount === 1 ? "" : "s"} referenced by a photo
          row {status.missingCount === 1 ? "is" : "are"} missing from the bucket. Those photos are
          broken in the app now — run <code>npm run r2:audit</code> to list them.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {status.orphans.map((o) => {
          const note = notes[o.group];
          const working = busy === o.group;
          return (
            <li
              key={o.group}
              className="flex items-start gap-3 rounded-[3px] border border-hairline bg-hull px-2.5 py-2"
            >
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[2px] bg-hull-hi">
                {o.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="coord">?</span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {o.ownerName ?? "Unknown uploader"}
                  {o.video && " · video"}
                </p>
                <p className="coord truncate">
                  {size(o.bytes)} ·{" "}
                  {[
                    o.variants.original ? "original" : null,
                    o.variants.display ? "display" : null,
                    o.variants.thumb ? "thumb" : null,
                  ]
                    .filter(Boolean)
                    .join(" + ")}
                  {o.modified && ` · ${new Date(o.modified).toLocaleDateString()}`}
                </p>

                {o.recovery === "display-only" && (
                  <p className="coord mt-0.5">
                    The original never finished uploading. Recovering keeps the 2560px copy.
                  </p>
                )}
                {o.recovery === "none" && (
                  <p className="coord mt-0.5">Nothing renderable here — discard only.</p>
                )}

                {o.recovery !== "none" && (
                  <label className="coord mt-1 flex items-center gap-2">
                    Date
                    <input
                      type="datetime-local"
                      value={dates[o.group] ?? ""}
                      onChange={(e) => setDates((d) => ({ ...d, [o.group]: e.target.value }))}
                      className="rounded-[2px] border border-hairline bg-hull-hi px-1 py-0.5 text-xs"
                    />
                  </label>
                )}

                {note && <p className="coord mt-1 text-coral">{note}</p>}
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                {o.recovery !== "none" && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={working}
                    onClick={() => void recover(o)}
                  >
                    {working ? "…" : "Recover"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={working || !o.prunable}
                  title={o.prunable ? undefined : "Too recent — may still be uploading"}
                  onClick={() => void discard(o)}
                >
                  Discard
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {recovered.length > 0 && (
        <p className="coord">
          Recovered {recovered.length} — {recovered.filter((r) => r.placed).length} already pinned
          from EXIF.
        </p>
      )}

      {placeable.length > 0 && (
        <div>
          <p className="eyebrow mb-1">PIN THE RESCUED ONES</p>
          <PlaceBoard
            items={placeable}
            onPlaced={(ids) =>
              setRecovered((prev) =>
                prev.map((r) => (ids.includes(r.photoId) ? { ...r, placed: true } : r)),
              )
            }
          />
        </div>
      )}
    </div>
  );
}
