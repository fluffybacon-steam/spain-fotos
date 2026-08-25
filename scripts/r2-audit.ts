// scripts/r2-audit.ts
/**
 * Reconciles the bucket against the database, in both directions.
 *
 *   npm run r2:audit                    report only, touches nothing
 *   npm run r2:audit -- --all           list every finding, not just the head
 *   npm run r2:audit -- --prune         delete orphaned objects, after asking
 *   npm run r2:audit -- --prune --yes   same, without the prompt
 *   npm run r2:audit -- --min-age-hours=1
 *
 * Two things can go wrong and they are not symmetrical.
 *
 * ORPHANS are objects nothing points at. An upload PUTs three objects to R2
 * and only then asks the API to write the row, so anything that stops it in
 * between — a refused duplicate, a closed tab, a dead connection — leaves the
 * bytes behind with no row to find them by. They cost storage and nothing else.
 *
 * MISSING is the other direction: a row whose object isn't there. That photo is
 * broken in the app right now, and no amount of pruning fixes it. It's the more
 * urgent finding even though it's usually the rarer one.
 *
 * On the age guard: an upload in flight looks exactly like an orphan, because
 * the objects land before the row does. Pruning is therefore restricted to
 * objects older than --min-age-hours (24 by default). Don't lower it to zero
 * while anyone might be uploading.
 */
import "./load-env";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/db/schema";
import { photos, users } from "../src/db/schema";
import { r2, BUCKET } from "../src/lib/r2";
import {
  audit,
  groupOf,
  type BucketObject,
  type MissingObject,
  type Orphan,
} from "../src/lib/orphans";

/**
 * Built on demand rather than at import. The audit logic below is pure and
 * worth testing on its own, and a module-scope client would demand a
 * DATABASE_URL just to import the file.
 */
function database() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("\n  DATABASE_URL is not set. Add it to .env, then re-run.\n");
    process.exit(1);
  }
  return drizzle(neon(url), { schema });
}

/** DeleteObjects accepts at most 1000 keys per call. */
const DELETE_CHUNK = 1000;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

async function listBucket(): Promise<BucketObject[]> {
  const out: BucketObject[] = [];
  let token: string | undefined;

  do {
    const page = await r2.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || typeof obj.Size !== "number") continue;
      out.push({ key: obj.Key, bytes: obj.Size, modified: obj.LastModified ?? null });
    }
    process.stdout.write(`\r  scanning bucket… ${out.length} objects`);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  process.stdout.write(`\r${" ".repeat(44)}\r`);
  return out;
}

async function prune(keys: string[]) {
  let done = 0;
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    const chunk = keys.slice(i, i + DELETE_CHUNK);
    await r2.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    done += chunk.length;
    process.stdout.write(`\r  deleting… ${done}/${keys.length}`);
  }
  process.stdout.write(`\r${" ".repeat(40)}\r`);
}

function size(bytes: number) {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function flag(name: string) {
  return process.argv.slice(2).includes(name);
}

function numberFlag(name: string, fallback: number) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  if (!hit) return fallback;
  const value = Number(hit.slice(name.length + 1));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function main() {
  const showAll = flag("--all");
  const wantsPrune = flag("--prune");
  const skipPrompt = flag("--yes");
  const minAgeHours = numberFlag("--min-age-hours", 24);

  const db = database();
  const [objects, rows, avatars] = await Promise.all([
    listBucket(),
    db
      .select({
        id: photos.id,
        ownerId: photos.ownerId,
        originalKey: photos.originalKey,
        displayKey: photos.displayKey,
        thumbKey: photos.thumbKey,
      })
      .from(photos),
    db.select({ avatarKey: users.avatarKey }).from(users),
  ]);

  const result = audit(
    objects,
    rows,
    avatars.map((a) => a.avatarKey).filter((k): k is string => !!k),
    { minAgeMs: minAgeHours * 3600_000, now: Date.now() },
  );

  const { orphans, missing, unrecognised, accounted, totalBytes } = result;
  const prunable = orphans.filter((o) => o.prunable);
  const tooRecent = orphans.filter((o) => !o.prunable);
  const orphanBytes = orphans.reduce((n, o) => n + o.bytes, 0);
  const prunableBytes = prunable.reduce((n, o) => n + o.bytes, 0);

  console.log(`\nBucket: ${BUCKET}`);
  console.log(
    `  ${plural(objects.length, "object")} (${size(totalBytes)})   ${plural(rows.length, "photo row")}\n`,
  );
  console.log(`  accounted for   ${String(accounted).padStart(7)}`);
  console.log(
    `  orphaned        ${String(orphans.length).padStart(7)}   ${size(orphanBytes)}` +
      (tooRecent.length ? `  (${tooRecent.length} too recent to judge)` : ""),
  );
  console.log(`  missing         ${String(missing.length).padStart(7)}   objects a row expects`);
  if (unrecognised.length) {
    console.log(`  unrecognised    ${String(unrecognised.length).padStart(7)}   outside photos/ and avatars/`);
  }

  if (missing.length) {
    // Listed first on purpose: these are broken in the app right now, and
    // pruning does nothing for them.
    const byPhoto = new Map<string, MissingObject[]>();
    for (const m of missing) byPhoto.set(m.photoId, [...(byPhoto.get(m.photoId) ?? []), m]);

    console.log(
      `\n  MISSING — ${plural(byPhoto.size, "photo")} referencing objects that aren't there`,
    );
    const shown = [...byPhoto.entries()].slice(0, showAll ? Infinity : 20);
    for (const [photoId, items] of shown) {
      const gone = items.map((i) => i.variant).join(", ");
      const whole = items.length === 3 ? "  (all three — the photo is unrecoverable)" : "";
      console.log(`    ${photoId}  missing: ${gone}${whole}`);
    }
    if (byPhoto.size > shown.length) {
      console.log(`    … and ${byPhoto.size - shown.length} more (--all to list)`);
    }
    console.log("    These rows need deleting from the app, or the objects restoring.");
  }

  if (orphans.length) {
    const byGroup = new Map<string, Orphan[]>();
    for (const o of orphans) byGroup.set(o.group, [...(byGroup.get(o.group) ?? []), o]);

    console.log(`\n  ORPHANED — ${plural(byGroup.size, "group")} with no row pointing at them`);
    const shown = [...byGroup.entries()].slice(0, showAll ? Infinity : 20);
    for (const [group, items] of shown) {
      const bytes = items.reduce((n, i) => n + i.bytes, 0);
      const held = items.some((i) => !i.prunable) ? "  [too recent — skipped]" : "";
      console.log(`    ${group.padEnd(46)} ${String(items.length).padStart(2)} obj  ${size(bytes).padStart(9)}${held}`);
    }
    if (byGroup.size > shown.length) {
      console.log(`    … and ${byGroup.size - shown.length} more (--all to list)`);
    }
  }

  if (!orphans.length && !missing.length && !unrecognised.length) {
    console.log("\n  Everything reconciles — every object has a row and every row has its objects.\n");
    return;
  }

  if (!prunable.length) {
    console.log(
      orphans.length
        ? `\n  Nothing old enough to prune (cutoff ${minAgeHours}h).\n`
        : "\n  Nothing to prune.\n",
    );
    return;
  }

  if (!wantsPrune) {
    console.log(
      `\n  ${plural(prunable.length, "object")} (${size(prunableBytes)}) can be pruned.` +
        `\n  Re-run with --prune to delete them.\n`,
    );
    return;
  }

  if (!skipPrompt) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `\n  Delete ${plural(prunable.length, "object")} (${size(prunableBytes)}) from ${BUCKET}? ` +
        `This cannot be undone. [y/N] `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("  Cancelled — nothing deleted.\n");
      return;
    }
  }

  await prune(prunable.map((o) => o.key));
  console.log(`\n  Deleted ${plural(prunable.length, "object")}, freeing ${size(prunableBytes)}.\n`);
}

// Guard so `tsx --test` and other importers can use audit() without running it.
if (process.argv[1] && process.argv[1].includes("r2-audit")) {
  main().catch((err) => {
    console.error("\nAudit failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
