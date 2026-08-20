"use client";
// src/app/(app)/debug/page.tsx

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { readExif } from "@/lib/client/exif";
import { isHeicLike } from "@/lib/client/prepare";

const PICKER_ACCEPT = "image/*,.heic,.heif";
/**
 * The trailing non-image type is load-bearing. With an images-only accept list,
 * Chrome on Android hands the request to the system photo picker, which redacts
 * GPS unless the calling app holds ACCESS_MEDIA_LOCATION — Chrome doesn't. One
 * non-image entry sends it to the documents provider instead, which doesn't.
 */
const SAF_ACCEPT = "image/*,.heic,.heif,text/plain";

const IMAGE_RE = /\.(jpe?g|png|heic|heif|webp|tiff?|avif)$/i;

/** Some pickers zero the tags rather than omitting them. 0,0 is not a location. */
function isNullIsland(lat: number | null, lng: number | null) {
  return lat !== null && lng !== null && Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7;
}

function metersBetween(a: Coords, b: Coords) {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Coords = { lat: number; lng: number };

type DeviceGeo =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "granted"; lat: number; lng: number; accuracy: number; at: string }
  | { status: "error"; message: string };

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
  /** Whether the page held device location when this file was picked. */
  geoAtPick: DeviceGeo["status"];
  device: Coords | null;
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
  const [geo, setGeo] = useState<DeviceGeo>({ status: "idle" });
  const [permission, setPermission] = useState("unread");

  const readPermission = useCallback(async () => {
    try {
      const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
      setPermission(p?.state ?? "unsupported");
    } catch {
      setPermission("unsupported");
    }
  }, []);

  useEffect(() => {
    void readPermission();
  }, [readPermission]);

  function requestGeo() {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "navigator.geolocation is missing — needs HTTPS or localhost" });
      return;
    }
    setGeo({ status: "asking" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          status: "granted",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: new Date(pos.timestamp).toISOString(),
        });
        void readPermission();
      },
      (err) => {
        setGeo({ status: "error", message: `${err.code} · ${err.message}` });
        void readPermission();
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  async function inspect(picked: File[], source: string) {
    // SAF_ACCEPT lets a .txt through, so drop anything that isn't an image.
    const files = picked.filter((f) => f.type.startsWith("image/") || IMAGE_RE.test(f.name));
    if (!files.length) return;

    // Snapshot the permission state now — it's the independent variable.
    const geoAtPick = geo.status;
    const device = geo.status === "granted" ? { lat: geo.lat, lng: geo.lng } : null;

    setBusy(true);
    let exifr: typeof import("exifr").default;
    try {
      exifr = (await import("exifr")).default;
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
        geoAtPick,
        device,
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

      <section
        className="mb-5 rounded-[3px] border p-3"
        style={{ borderColor: "var(--color-hairline)", background: "var(--color-hull)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Device location</p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={requestGeo} disabled={geo.status === "asking"}>
            {geo.status === "granted" ? "Refresh" : "Ask for location"}
          </button>
        </div>

        <dl className="coord mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt>permission</dt><dd>{permission}</dd>
          <dt>state</dt>
          <dd>
            {geo.status === "granted"
              ? `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)} ±${Math.round(geo.accuracy)}m`
              : geo.status === "error"
                ? geo.message
                : geo.status}
          </dd>
        </dl>

        <p className="mt-2 text-sm text-haze">
          Grant this, then re-pick the same photo through button 1 and compare the two
          reports. Android redacts GPS in the photo picker based on a permission the
          browser holds, not one the page holds, so expect no change — the readout below
          records which reports were taken before and after so the result is unambiguous.
        </p>
      </section>

      <input
        ref={pickerRef}
        type="file"
        multiple
        accept={PICKER_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          // Snapshot before clearing the input — the FileList is live.
          void inspect(Array.from(e.target.files ?? []), "photo picker");
          e.target.value = "";
        }}
      />
      <input
        ref={filesRef}
        type="file"
        multiple
        accept={SAF_ACCEPT}
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
          const zeroed = isNullIsland(r.ours.lat, r.ours.lng);
          const found = r.ours.lat !== null && !zeroed;
          const drift =
            found && r.device
              ? metersBetween({ lat: r.ours.lat as number, lng: r.ours.lng as number }, r.device)
              : null;
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
                ) : zeroed ? (
                  <>❌ <strong>Coordinates zeroed</strong> — the tags are present but read 0, 0. The picker blanked them rather than removing them.</>
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
                <dt>geo perm</dt><dd>{r.geoAtPick}</dd>
                {drift !== null && (
                  <>
                    <dt>vs device</dt>
                    <dd>{drift < 1000 ? `${Math.round(drift)} m` : `${(drift / 1000).toFixed(1)} km`}</dd>
                  </>
                )}
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