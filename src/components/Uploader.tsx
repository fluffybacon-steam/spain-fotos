"use client";
// src/components/Uploader.tsx

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { preparePhoto, putWithProgress, isSupportedImage } from "@/lib/client/prepare";

type Stage = "queued" | "reading" | "uploading" | "done" | "failed";

type Job = {
  key: string;
  file: File;
  stage: Stage;
  progress: number;
  hasLocation: boolean;
  preview: string | null;
  error?: string;
};

// Two at a time: enough to keep the pipe full, few enough that a mid-range
// phone doesn't run out of memory decoding several 48-megapixel HEICs at once.
const CONCURRENCY = 2;

export default function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);

  function patch(key: string, changes: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, ...changes } : j)));
  }

  function addFiles(list: FileList | null) {
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
      }));
    setJobs((prev) => [...prev, ...incoming]);
  }

  async function runOne(job: Job) {
    patch(job.key, { stage: "reading" });

    const prepared = await preparePhoto(job.file);
    const previewUrl = URL.createObjectURL(prepared.thumb);
    patch(job.key, {
      preview: previewUrl,
      hasLocation: prepared.exif.lat !== null,
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
  const withoutLocation = jobs.filter((j) => j.stage === "done" && !j.hasLocation).length;

  return (
    <div className="flex flex-col gap-5">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif,.HEIC,.HEIF"
        className="sr-only"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = ""; // allow re-picking the same file after a failure
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="grid place-items-center rounded-[4px] border border-dashed border-hairline bg-hull/50 px-6 py-10 text-center transition-colors hover:border-shoal"
      >
        <span className="font-display text-xl font-bold">Choose photos</span>
        <span className="mt-1.5 text-sm text-haze">
          Pick from your camera roll, not a chat thread — that&apos;s where the location lives
        </span>
      </button>

      {jobs.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="coord">
              {jobs.length} selected · {done} uploaded
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
                    {job.stage === "failed"
                      ? job.error
                      : job.stage === "done"
                        ? job.hasLocation
                          ? "Placed on the map"
                          : "No location — you can pin it by hand"
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
                  {job.stage === "done" ? (job.hasLocation ? "📍" : "❓") : job.stage === "failed" ? "⚠️" : ""}
                </span>
              </li>
            ))}
          </ul>

          {withoutLocation > 0 && !running && (
            <div className="rounded-[3px] border border-buoy/40 bg-buoy/10 px-3.5 py-3">
              <p className="text-sm">
                {withoutLocation} {withoutLocation === 1 ? "photo has" : "photos have"} no GPS data.
                Open the map and use <strong>unplaced</strong> in the top bar to drop pins by hand.
              </p>
            </div>
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
