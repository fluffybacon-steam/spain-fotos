"use client";
// src/app/(app)/debug/page.tsx

import { useRef, useState } from "react";
import Link from "next/link";
import { readExif } from "@/lib/client/exif";
import { isHeicLike } from "@/lib/client/prepare";

type Report = {
  name: string;
  type: string;
  sizeMB: string;
  lastModified: string;
  heic: boolean;
  ours: Awaited<ReturnType<typeof readExif>>;
  rawKeys: string[];
  gpsHelper: unknown;
  hasAnyExif: boolean;
  error?: string;
};

/**
 * Nothing here uploads or writes anything — it reads the picked file in the
 * browser and reports what the metadata actually contains. The point is to
 * separate "the phone stripped the location" from "the app failed to read it",
 * which are indistinguishable from the upload screen.
 */
export default function DebugPage() {
  const pickerRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);

  async function inspect(files: File[], source: string) {
    if (!files.length) return;
    setBusy(true);
    try {
      var exifr = (await import("exifr")).default;
    } catch {
      setBusy(false);
      return;
    }
    const out: Report[] = [];

    for (const file of files) {
      const base = {
        name: `${file.name}  [via ${source}]`,
        type: file.type || "(none reported)",
        sizeMB: (file.size / 1_048_576).toFixed(2),
        lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : "(none)",
        heic: isHeicLike(file),
      };
      try {
        const raw = await exifr.parse(file, true).catch(() => null);
        const gpsHelper = await exifr.gps(file).catch(() => null);
        out.push({
          ...base,
          ours: await readExif(file),
          rawKeys: raw ? Object.keys(raw).sort() : [],
          gpsHelper: gpsHelper ?? null,
          hasAnyExif: Boolean(raw && Object.keys(raw).length),
        });
      } catch (err) {
        out.push({
          ...base,
          ours: { lat: null, lng: null, takenAt: null, cameraMake: null, cameraModel: null },
          rawKeys: [],
          gpsHelper: null,
          hasAnyExif: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setReports((prev) => [...out, ...prev]);
    setBusy(false);
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Nothing is uploaded from this page</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Metadata check</h1>
        </div>
        <Link href="/" className="btn btn-quiet btn-sm">Map</Link>
      </div>

      <p className="mb-5 text-sm text-haze">
        Pick the same photo through both buttons. On Android they often open different
        pickers, and the two frequently disagree about whether location survives.
      </p>

      <input
        ref={pickerRef}
        type="file"
        multiple
        accept="file"
        className="sr-only"
        onChange={(e) => {
          // Snapshot before clearing the input — the FileList is live.
          void inspect(Array.from(e.target.files ?? []), "g picker");
          e.target.value = "";
        }}
      />
      {/* No accept attribute: Android routes this to the documents browser
          rather than the media picker, which is the path that tends to
          preserve GPS. */}
      <input
        ref={filesRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          void inspect(Array.from(e.target.files ?? []), "file browser");
          e.target.value = "";
        }}
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn btn-primary flex-1" onClick={() => pickerRef.current?.click()} disabled={busy}>
          1 · Photo picker
        </button>
        <button type="button" className="btn btn-quiet flex-1" onClick={() => filesRef.current?.click()} disabled={busy}>
          2 · File browser
        </button>
      </div>

      {busy && <p className="coord mt-4 animate-pulse">Reading…</p>}

      <div className="mt-6 flex flex-col gap-3">
        {reports.map((r, i) => {
          const found = r.ours.lat !== null;
          return (
            <section
              key={i}
              className="rounded-[3px] border p-3"
              style={{
                borderColor: found ? "var(--color-shoal)" : "var(--color-hairline)",
                background: found ? "color-mix(in srgb, var(--color-shoal) 10%, transparent)" : "var(--color-hull)",
              }}
            >
              <p className="truncate text-sm font-semibold">{r.name}</p>

              <p className="mt-2 text-sm">
                {found ? (
                  <>✅ <strong>Location found:</strong> {r.ours.lat?.toFixed(5)}, {r.ours.lng?.toFixed(5)}</>
                ) : r.hasAnyExif ? (
                  <>❌ <strong>No GPS tags</strong> — the file has EXIF ({r.rawKeys.length} fields) but no coordinates. Something stripped them.</>
                ) : (
                  <>❌ <strong>No EXIF at all</strong> — fully re-encoded, or the picker redacted everything.</>
                )}
              </p>

              <dl className="coord mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt>mime</dt><dd>{r.type}</dd>
                <dt>size</dt><dd>{r.sizeMB} MB</dd>
                <dt>heic</dt><dd>{r.heic ? "yes" : "no"}</dd>
                <dt>taken</dt><dd>{r.ours.takenAt ? r.ours.takenAt.toISOString() : "—"}</dd>
                <dt>camera</dt><dd>{r.ours.cameraMake ?? "—"} {r.ours.cameraModel ?? ""}</dd>
                <dt>mtime</dt><dd>{r.lastModified}</dd>
                <dt>gps()</dt><dd>{JSON.stringify(r.gpsHelper)}</dd>
              </dl>

              {r.rawKeys.length > 0 && (
                <details className="mt-2">
                  <summary className="coord cursor-pointer">{r.rawKeys.length} EXIF fields present</summary>
                  <p className="coord mt-1 break-words">{r.rawKeys.join(", ")}</p>
                </details>
              )}

              {r.error && <p className="coord mt-2 text-coral">{r.error}</p>}
            </section>
          );
        })}
      </div>
    </main>
  );
}
