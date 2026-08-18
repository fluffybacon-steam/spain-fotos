// src/lib/client/exif.ts
import exifr from "exifr";

export type PhotoExif = {
  lat: number | null;
  lng: number | null;
  takenAt: Date | null;
  cameraMake: string | null;
  cameraModel: string | null;
};

/**
 * Read metadata from the ORIGINAL File, before any conversion or canvas round
 * trip. Every transform downstream destroys GPS tags, so this has to happen
 * first and it has to happen on the untouched bytes.
 *
 * exifr parses HEIC containers as well as JPEG, so this runs identically for
 * iPhone and Android files.
 */
export async function readExif(file: File): Promise<PhotoExif> {
  const empty: PhotoExif = { lat: null, lng: null, takenAt: null, cameraMake: null, cameraModel: null };

  try {
    // Deliberately no `pick` filter. `latitude`/`longitude` are computed by
    // exifr's GPS parser rather than being raw tags, so a tag-level pick list
    // can silently suppress them — and coordinates are the whole point here.
    // Enabling the three blocks costs a few milliseconds and cannot misfire.
    const data = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      mergeOutput: true,
    });
    if (!data) return empty;

    let lat = numeric(data.latitude);
    let lng = numeric(data.longitude);

    // Second attempt via the dedicated GPS reader. Some files carry GPS in a
    // layout the general parse doesn't surface, and this costs nothing when the
    // first attempt already succeeded.
    if (lat === null || lng === null) {
      const gps = await exifr.gps(file).catch(() => null);
      if (gps) {
        lat = numeric(gps.latitude);
        lng = numeric(gps.longitude);
      }
    }

    return {
      // 0,0 in the Gulf of Guinea is the classic "GPS chip returned nothing"
      // sentinel. Treat it as absent rather than pinning everyone to Null Island.
      lat: lat !== null && lng !== null && !(lat === 0 && lng === 0) ? lat : null,
      lng: lat !== null && lng !== null && !(lat === 0 && lng === 0) ? lng : null,
      takenAt: asDate(data.DateTimeOriginal) ?? asDate(data.CreateDate) ?? fallbackDate(file),
      cameraMake: str(data.Make),
      cameraModel: str(data.Model),
    };
  } catch {
    return { ...empty, takenAt: fallbackDate(file) };
  }
}

function numeric(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s.slice(0, 80) : null;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  return null;
}

// Better than nothing for screenshots and re-encoded files: most phones and
// messaging apps preserve a plausible file mtime even when they strip EXIF.
function fallbackDate(file: File): Date | null {
  return file.lastModified ? new Date(file.lastModified) : null;
}
