"use client";
// src/components/Uploader.tsx

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { preparePhoto, putWithProgress, isSupportedImage, isVideo } from "@/lib/client/prepare";
import { formatDuration } from "@/lib/client/video";
import { contentHash } from "@/lib/client/hash";
import { posterFromVideo } from "@/lib/video-poster";
import PlaceBoard, { type PlaceableItem } from "@/components/PlaceBoard";

type Stage = "queued" | "reading" | "uploading" | "done" | "failed" | "duplicate";

type Job = {
  key: string;
  file: File;
  stage: Stage;
  progress: number;
  hasLocation: boolean;
  /** Row id minted at presign time — needed to place the photo afterwards. */
  photoId?: string;
  /** Null until a video's poster frame is pulled, and if it can't be. */
  preview: string | null;
  video: boolean;
  durationMs?: number | null;
  posterFailed?: boolean;
  hash?: string;
  duplicateOf?: string;
  error?: string;
};

// Two at a time: enough to keep the pipe full, few enough that a mid-range
// phone doesn't run out of memory decoding several 48-megapixel HEICs at once.
const CONCURRENCY = 2;

/** How long a delete stays armed before it disarms itself. */
const CONFIRM_MS = 4000;

export default function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);

  /** Every blob URL this component minted, so none of them outlive it. */
  const owned = useRef(new Set<string>());
  /** Jobs still on screen. A poster arriving for a removed job is binned. */
  const live = useRef(new Set<string>());
  /** Cancels in-flight frame extraction when the page goes away. */
  const abort = useRef<AbortController | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Hashes spoken for by the current run, mapped to the job holding them.
   *
   * /api/photos/check can only see what's already saved, and two workers run at
   * once — so two copies of one file in the same selection both ask before
   * either has written anything, and both get told it's new. This is the part
   * the server can't answer.
   */
  const claimed = useRef(new Map<string, string>());

  useEffect(() => {
    abort.current = new AbortController();
    const urls = owned.current;
    const controller = abort.current;
    return () => {
      controller.abort();
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // The board has to survive its own success. Once every photo is placed,
  // `placeable` empties — and if that unmounted PlaceBoard, its "all filed"
  // state would go with it. Open it once, then only hide it.
  useEffect(() => {
    if (placeable.length) {
      setBoardOpen(true);
    }
    else if (!jobs.length) {
      setBoardOpen(false);
    } 
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  useEffect(()=>{
    if(!boardOpen) return;
    if (boardRef.current) {
      boardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [boardOpen])

  function track(url: string) {
    owned.current.add(url);
    return url;
  }

  function release(url: string | null | undefined) {
    if (url && owned.current.delete(url)) URL.revokeObjectURL(url);
  }

  function patch(key: string, changes: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, ...changes } : j)));
  }

  /** Drops a job from the list. Local only — nothing server-side. */
  function drop(job: Job) {
    live.current.delete(job.key);
    release(job.preview);
    setConfirming((c) => (c === job.key ? null : c));
    setJobs((prev) => prev.filter((j) => j.key !== job.key));
  }

  /**
   * Removing a job that already uploaded has to delete the photo, not just
   * hide the row. Otherwise the file stays in storage and on the map with no
   * coordinates and no way back to it — the row was the only handle on it.
   */
  async function removeJob(key: string) {
    const job = jobs.find((j) => j.key === key);
    if (!job || job.stage === "uploading" || job.stage === "reading") return;

    // Queued, failed and duplicate rows never became photos. Dropping is all
    // there is to do.
    if (job.stage !== "done" || !job.photoId) {
      drop(job);
      return;
    }

    setRemoving((prev) => new Set(prev).add(key));
    patch(key, { error: undefined });

    try {
      // DELETE /api/photos doesn't exist — the collection route only answers
      // GET and POST, so this used to 405 every time. The per-photo route is
      // the one that deletes, and it already owns the permission check and the
      // R2 cleanup, so there's nothing to duplicate here.
      const res = await fetch(`/api/photos/${encodeURIComponent(job.photoId)}`, {
        method: "DELETE",
      });

      // 404 is this photo's row already being gone, which is the outcome we
      // were asking for. Anything else is a real failure and keeps the row.
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Couldn't delete this (${res.status})`);
      }

      drop(job);
      router.refresh();
    } catch (err) {
      patch(key, {
        error: err instanceof Error ? err.message : "Couldn't delete this",
      });
      setConfirming(null);
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  /** First tap on an uploaded row arms the delete; the second one does it. */
  function armDelete(key: string) {
    setConfirming(key);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirming(null), CONFIRM_MS);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const stamp = Date.now();

    const incoming: Job[] = Array.from(list)
      .filter(isSupportedImage)
      .map((file, i) => {
        const video = isVideo(file);
        return {
          key: `${stamp}-${i}-${file.name}`,
          file,
          stage: "queued" as Stage,
          progress: 0,
          hasLocation: false,
          // An <img> has no video decoder, so an object URL for a clip renders
          // as a broken tile. Clips get a poster frame a moment later instead.
          preview: video ? null : track(URL.createObjectURL(file)),
          video,
        };
      });

    if (!incoming.length) return;
    incoming.forEach((j) => live.current.add(j.key));
    setJobs((prev) => [...prev, ...incoming]);
    void fillPosters(incoming);
  }

  /**
   * Pulls the first usable frame out of each queued clip.
   *
   * Sequential on purpose: every extraction holds a decoder open, and a phone
   * handed thirty clips at once drops the tab rather than queueing them.
   */
  async function fillPosters(rows: Job[]) {
    for (const row of rows) {
      if (!row.video || !live.current.has(row.key)) continue;

      const poster = await posterFromVideo(row.file, {
        maxEdge: 320,
        signal: abort.current?.signal,
      });

      if (!poster) {
        patch(row.key, { posterFailed: true });
        continue;
      }
      if (!live.current.has(row.key)) {
        URL.revokeObjectURL(poster.url); // the row left while we were decoding
        continue;
      }

      track(poster.url);
      patch(row.key, { preview: poster.url, posterFailed: false });
    }
  }

  async function runOne(job: Job) {
    patch(job.key, { stage: "reading" });

    // Fingerprint before doing any work — a duplicate should cost nothing.
    const hash = await contentHash(job.file);
    patch(job.key, { hash });

    // Claim it for this run before asking the server, so the identical file
    // sitting two rows down is caught without a round trip.
    const claimedBy = claimed.current.get(hash);
    if (claimedBy && claimedBy !== job.key) {
      patch(job.key, { stage: "duplicate", progress: 1, duplicateOf: "you" });
      return;
    }
    claimed.current.set(hash, job.key);

    const check = await fetch("/api/photos/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: [hash] }),
    });
    if (check.ok) {
      const { mine, others } = await check.json();
      if (mine.includes(hash)) {
        patch(job.key, { stage: "duplicate", progress: 1, duplicateOf: "you" });
        return;
      }
      if (others?.[hash]) patch(job.key, { duplicateOf: others[hash] });
    }

    const prepared = await preparePhoto(job.file);
    patch(job.key, {
      hasLocation: prepared.exif.lat !== null,
      durationMs: prepared.durationMs,
      posterFailed: prepared.posterFailed,
      stage: "uploading",
    });

    const presignRes = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ ext: prepared.ext, originalMime: job.file.type || "application/octet-stream" }],
      }),
    });
    if (!presignRes.ok) throw new Error("Couldn't get an upload slot");
    const { slots } = await presignRes.json();
    const slot = slots[0];
    patch(job.key, { photoId: slot.id });

    // Weight progress by payload: the original dominates the transfer.
    let originalDone = 0;
    const report = () => patch(job.key, { progress: 0.1 + originalDone * 0.8 });

    await Promise.all([
      putWithProgress(slot.uploads.originalUrl, job.file, slot.originalMime, (f) => {
        originalDone = f;
        report();
      }),
      putWithProgress(slot.uploads.displayUrl, prepared.display, "image/jpeg"),
      putWithProgress(slot.uploads.thumbUrl, prepared.thumb, "image/jpeg"),
    ]);

    patch(job.key, { progress: 0.95 });

    const saveRes = await fetch("/api/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: [
          {
            id: slot.id,
            ...slot.keys,
            mediaType: prepared.mediaType,
            durationMs: prepared.durationMs,
            contentHash: hash,
            originalName: job.file.name,
            originalMime: slot.originalMime,
            originalBytes: job.file.size,
            width: prepared.width,
            height: prepared.height,
            lat: prepared.exif.lat,
            lng: prepared.exif.lng,
            locationSource: prepared.exif.lat !== null ? "exif" : null,
            takenAt: prepared.exif.takenAt ? prepared.exif.takenAt.toISOString() : null,
            cameraMake: prepared.exif.cameraMake,
            cameraModel: prepared.exif.cameraModel,
          },
        ],
      }),
    });
    if (!saveRes.ok) throw new Error("Uploaded, but couldn't be saved");

    // The unique index has the last word. If it refused the row, the photo was
    // already in the trip and the id from presign now points at nothing — so
    // clear it, or the ❌ on this row aims a delete at a photo that was never
    // created and the whole thing reads as a successful upload.
    const { duplicates } = (await saveRes.json().catch(() => ({}))) as {
      duplicates?: string[];
    };
    if (duplicates?.includes(slot.id)) {
      patch(job.key, {
        stage: "duplicate",
        progress: 1,
        duplicateOf: "you",
        photoId: undefined,
      });
      return;
    }

    patch(job.key, { stage: "done", progress: 1 });
  }

  async function start() {
    setRunning(true);
    // Claims only describe the run in progress. Starting fresh means a retry
    // after a failure isn't blocked by the claim its first attempt left behind.
    claimed.current.clear();
    const pending = jobs.filter((j) => j.stage === "queued" || j.stage === "failed");
    const queue = [...pending];

    async function worker() {
      while (queue.length) {
        const job = queue.shift()!;
        try {
          await runOne(job);
        } catch (err) {
          // Nothing was saved, so let go of the hash — otherwise an identical
          // file later in this run is called a duplicate of something that
          // doesn't exist.
          for (const [h, k] of claimed.current) {
            if (k === job.key) claimed.current.delete(h);
          }
          patch(job.key, {
            stage: "failed",
            error: err instanceof Error ? err.message : "Something went wrong",
          });
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
    router.refresh();
  }

  const queued = jobs.filter((j) => j.stage === "queued" || j.stage === "failed").length;
  const done = jobs.filter((j) => j.stage === "done").length;
  const skipped = jobs.filter((j) => j.stage === "duplicate").length;
  const withoutLocation = jobs.filter((j) => j.stage === "done" && !j.hasLocation).length;

  // Only uploads that finished, kept no coordinates, and have both a row id and
  // a thumbnail already in memory. The preview is a blob URL from the resize
  // step — or, for clips, the extracted poster — so the board costs no network.
  const placeable: PlaceableItem[] = jobs
    .filter((j) => j.stage === "done" && !j.hasLocation && j.photoId && j.preview)
    .map((j) => ({ id: j.photoId!, thumbUrl: j.preview!, label: j.file.name }));

  return (
    <div className="flex flex-col gap-5">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,.heic,.heif,.HEIC,.HEIF,.mov,.MOV"
        className="sr-only"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = ""; // allow re-picking the same file after a failure
        }}
      />

      {/* No accept attribute: on Android this opens the documents browser
          instead of the media picker. Android 13+ redacts location from photo
          picker results, so this route often keeps GPS when the other loses it. */}
      <input
        ref={browseRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="grid place-items-center rounded-[4px] border border-dashed border-hairline bg-hull/50 px-6 py-10 text-center transition-colors hover:border-shoal"
      >
        <span className="font-display text-xl font-bold">Choose fotos/vids</span>
      </button>

      {jobs.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="coord">
              {jobs.length} selected · {done} uploaded
              {skipped > 0 && ` · ${skipped} already there`}
              {queued > 0 && ` · ${queued} waiting`}
            </p>
            <button
              type="button"
              className={queued ? "btn btn-primary lookAtMe" : "btn btn-primary"}
              onClick={start}
              disabled={running || queued === 0}
            >
              {running ? "Uploading…" : `Upload ${queued}`}
            </button>
          </div>

          <ul className="flex flex-col gap-1.5">
            {jobs.map((job) => (
              <li
                key={job.key}
                data-stage={job.stage}
                className="flex items-center gap-3 rounded-[3px] border border-hairline bg-hull px-2.5 py-2"
              >
                <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[2px] bg-hull-hi">
                  {job.preview ? (
                    <img src={job.preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="slug" data-video={job.video ? "true" : "false"} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{job.file.name}</p>
                  <p className="coord truncate">
                    {job.stage === "duplicate"
                      ? "Already uploaded — skipped"
                      : job.stage === "failed"
                      ? job.error
                      : job.stage === "done"
                        ? [
                            job.video && job.durationMs ? formatDuration(job.durationMs) : null,
                            job.hasLocation ? "Placed on the map" : "No location — pin it by hand",
                            job.posterFailed ? "no preview (codec)" : null,
                            job.duplicateOf && job.duplicateOf !== "you"
                              ? `${job.duplicateOf} has this too`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : job.stage === "reading"
                          ? "Reading metadata"
                          : job.stage === "uploading"
                            ? `${Math.round(job.progress * 100)}%`
                            : `${(job.file.size / 1_048_576).toFixed(1)} MB`}
                  </p>
                  {job.stage === "uploading" && (
                    <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-hull-hi">
                      <div
                        className="h-full bg-shoal transition-[width] duration-200"
                        style={{ width: `${job.progress * 100}%` }}
                      />
                    </div>
                  )}
                  {job.stage === "done" && job.error && (
                    <p className="mt-0.5 truncate text-xs text-coral">{job.error}</p>
                  )}
                </div>

                <span aria-hidden="true" className="text-md">
                  {job.stage === "duplicate"
                    ? ""
                    : job.stage === "done"
                      ? job.video
                        ? "🎬"
                        : job.hasLocation
                          ? "📍"
                          : "❓"
                      : job.stage === "failed"
                        ? "⚠️"
                        : ""}
                </span>

                <button
                  type="button"
                  className="shrink-0 pl-1 text-sm"
                  disabled={
                    job.stage === "uploading" || job.stage === "reading" || removing.has(job.key)
                  }
                  aria-label={
                    job.stage === "done" && job.photoId
                      ? confirming === job.key
                        ? `Delete ${job.file.name} from the trip`
                        : `Remove ${job.file.name} — this deletes it`
                      : `Remove ${job.file.name}`
                  }
                  onClick={() => {
                    // Uploaded rows are a real deletion, so they take two taps.
                    if (job.stage === "done" && job.photoId && confirming !== job.key) {
                      armDelete(job.key);
                      return;
                    }
                    void removeJob(job.key);
                  }}
                >
                  {removing.has(job.key) ? (
                    <span className="coord">…</span>
                  ) : confirming === job.key ? (
                    <span className="text-xs font-bold text-coral">Delete?</span>
                  ) : (
                    "❌"
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* Hidden rather than unmounted: PlaceBoard's record of what it filed
              is the confirmation, and it can't survive being torn down. */}
          {boardOpen && (
            <div hidden={running} ref={boardRef}>
              <PlaceBoard
                items={placeable}
                onPlaced={(ids) =>
                  setJobs((prev) =>
                    prev.map((j) =>
                      j.photoId && ids.includes(j.photoId) ? { ...j, hasLocation: true } : j,
                    ),
                  )
                }
              />
            </div>
          )}

          {withoutLocation > 0 && !running && (
            <p className="coord">
              Need somewhere that isn&apos;t on the list? Use <strong>unplaced</strong> on the map to
              drop a pin. To find out what stripped the coordinates, open{" "}
              <a href="/debug" className="underline underline-offset-2">the metadata check</a>.
            </p>
          )}

          {done > 0 && !running && (
            <a href="/" className="btn btn-quiet">
              Back to the map
            </a>
          )}
        </>
      )}
    </div>
  );
}