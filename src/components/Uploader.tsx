"use client";
// src/components/Uploader.tsx

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { preparePhoto, putWithProgress, isSupportedImage, isVideo } from "@/lib/client/prepare";
import { formatDuration } from "@/lib/client/video";
import { contentHash } from "@/lib/client/hash";
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

export default function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);

  function patch(key: string, changes: Partial<Job>) {
    console.log("patch");
    setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, ...changes } : j)));
  }

  function addFiles(list: FileList | null) {
    console.log("addFiles");
    if (!list) return;
    const incoming = Array.from(list)
      .filter(isSupportedImage)
      .map((file, i) => ({
        key: `${Date.now()}-${i}-${file.name}`,
        file,
        stage: "queued" as Stage,
        progress: 0,
        hasLocation: false,
        preview: null,
        video: isVideo(file),
      }));
    setJobs((prev) => [...prev, ...incoming]);
  }

  async function runOne(job: Job) {
    console.log("runOne");
    patch(job.key, { stage: "reading" });

    // Fingerprint before doing any work — a duplicate should cost nothing.
    const hash = await contentHash(job.file);
    patch(job.key, { hash });

    const check = await fetch("/api/photos/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: [hash] }),
    });
    console.log('check', check);
    console.log(await check.json());
    if (check.ok) {
      const { mine, others } = await check.json();
      if (mine.includes(hash)) {
        patch(job.key, { stage: "duplicate", progress: 1, duplicateOf: "you" });
        return;
      }
      if (others?.[hash]) patch(job.key, { duplicateOf: others[hash] });
    }

    const prepared = await preparePhoto(job.file);
    const previewUrl = URL.createObjectURL(prepared.thumb);
    patch(job.key, {
      preview: previewUrl,
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

    patch(job.key, { stage: "done", progress: 1 });
  }

  async function start() {
    console.log("start()");
    setRunning(true);
    const pending = jobs.filter((j) => j.stage === "queued" || j.stage === "failed");
    const queue = [...pending];

    async function worker() {
      while (queue.length) {
        const job = queue.shift()!;
        try {
          await runOne(job);
        } catch (err) {
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
  // step, so the board costs no extra network.
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
        <span className="mt-1.5 text-sm text-haze">
          Click or drop into 🌋
        </span>
      </button>

      <button
        type="button"
        onClick={() => browseRef.current?.click()}
        className="coord underline underline-offset-2 hover:text-foam"
      >
        On Android and losing locations? Browse files instead
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
              className="btn btn-primary"
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
                className="flex items-center gap-3 rounded-[3px] border border-hairline bg-hull px-2.5 py-2"
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[2px] bg-hull-hi">
                  {job.preview ? (
                    <img src={job.preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="coord">•••</span>
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
                </div>

                <span aria-hidden="true" className="text-sm">
                  {job.stage === "duplicate"
                    ? "⏭"
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
              </li>
            ))}
          </ul>

          {placeable.length > 0 && !running && (
            <PlaceBoard
              items={placeable}
              onPlaced={(ids) =>
                setJobs((prev) =>
                  prev.map((j) => (j.photoId && ids.includes(j.photoId) ? { ...j, hasLocation: true } : j)),
                )
              }
            />
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
