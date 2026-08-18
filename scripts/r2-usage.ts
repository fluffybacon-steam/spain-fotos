// scripts/r2-usage.ts
/**
 * Breaks R2 usage down by variant, so a decision about dropping originals is
 * made against real numbers rather than a guess.
 *
 *   npx tsx scripts/r2-usage.ts
 *
 * Read-only: it lists object metadata and never fetches, writes or deletes.
 * Listing costs one Class A operation per 1000 objects.
 */
import "./load-env";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2, BUCKET } from "../src/lib/r2";

type Bucketed = { count: number; bytes: number };

const GB = 1024 ** 3;
const R2_PER_GB_MONTH = 0.015; // Standard storage. Verify against current pricing.

function empty(): Bucketed {
  return { count: 0, bytes: 0 };
}

function add(into: Map<string, Bucketed>, key: string, bytes: number) {
  const slot = into.get(key) ?? empty();
  slot.count += 1;
  slot.bytes += bytes;
  into.set(key, slot);
}

/** photos/{user}/{id}/original.heic -> "original", display.jpg -> "display" */
function variantOf(key: string): string {
  const file = key.split("/").pop() ?? "";
  const stem = file.split(".")[0];
  if (stem === "original" || stem === "display" || stem === "thumb") return stem;
  return "other";
}

function extensionOf(key: string): string {
  const file = key.split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot === -1 ? "(none)" : file.slice(dot + 1).toLowerCase();
}

const VIDEO_EXT = new Set(["mov", "mp4", "m4v", "3gp", "avi", "mkv", "webm"]);

async function main() {
  const byVariant = new Map<string, Bucketed>();
  const byOriginalExt = new Map<string, Bucketed>();
  const originalsPhoto = empty();
  const originalsVideo = empty();

  let token: string | undefined;
  let total = 0;
  let totalBytes = 0;
  let pages = 0;

  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token, MaxKeys: 1000 }),
    );
    pages += 1;
    process.stdout.write(`\r  scanning… ${total} objects`);

    for (const obj of page.Contents ?? []) {
      const key = obj.Key;
      const bytes = obj.Size;
      if (!key || typeof bytes !== "number") continue;

      total += 1;
      totalBytes += bytes;

      const variant = variantOf(key);
      add(byVariant, variant, bytes);

      if (variant === "original") {
        const ext = extensionOf(key);
        add(byOriginalExt, ext, bytes);
        const target = VIDEO_EXT.has(ext) ? originalsVideo : originalsPhoto;
        target.count += 1;
        target.bytes += bytes;
      }
    }

    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  process.stdout.write(`\r${" ".repeat(40)}\r`);

  const gb = (b: number) => (b / GB).toFixed(3).padStart(9);
  const cost = (b: number) => `$${((b / GB) * R2_PER_GB_MONTH).toFixed(2)}`.padStart(8);
  const mean = (b: Bucketed) => (b.count ? `${(b.bytes / b.count / 1024 / 1024).toFixed(2)} MB` : "—");

  console.log(`\nBucket: ${BUCKET}   (${pages} list call${pages === 1 ? "" : "s"})\n`);
  console.log("  variant        objects        GB     $/month      mean");
  console.log("  " + "─".repeat(56));

  for (const name of ["original", "display", "thumb", "other"]) {
    const slot = byVariant.get(name);
    if (!slot) continue;
    console.log(
      `  ${name.padEnd(12)} ${String(slot.count).padStart(7)}  ${gb(slot.bytes)}  ${cost(slot.bytes)}   ${mean(slot).padStart(9)}`,
    );
  }

  console.log("  " + "─".repeat(56));
  console.log(
    `  ${"TOTAL".padEnd(12)} ${String(total).padStart(7)}  ${gb(totalBytes)}  ${cost(totalBytes)}\n`,
  );

  console.log("  originals split by media type");
  console.log(
    `    photos   ${String(originalsPhoto.count).padStart(6)}  ${gb(originalsPhoto.bytes)} GB   mean ${mean(originalsPhoto)}`,
  );
  console.log(
    `    videos   ${String(originalsVideo.count).padStart(6)}  ${gb(originalsVideo.bytes)} GB   mean ${mean(originalsVideo)}\n`,
  );

  const sortedExt = [...byOriginalExt.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8);
  if (sortedExt.length) {
    console.log("  originals by extension");
    for (const [ext, slot] of sortedExt) {
      console.log(
        `    ${ext.padEnd(8)} ${String(slot.count).padStart(6)}  ${gb(slot.bytes)} GB   mean ${mean(slot)}`,
      );
    }
    console.log();
  }

  // The actual decision: photo originals are the only bucket that can be
  // dropped without losing a feature. Video originals are the playable asset.
  if (originalsPhoto.bytes > 0) {
    console.log(
      `  Dropping photo originals would free ${(originalsPhoto.bytes / GB).toFixed(2)} GB ` +
        `(${((originalsPhoto.bytes / totalBytes) * 100).toFixed(0)}% of the bucket), ` +
        `saving ${cost(originalsPhoto.bytes).trim()}/month.`,
    );
    console.log("  Video originals cannot be dropped — they are what the player streams.\n");
  }
}

main().catch((err) => {
  console.error("\nFailed to read the bucket:", err instanceof Error ? err.message : err);
  process.exit(1);
});
