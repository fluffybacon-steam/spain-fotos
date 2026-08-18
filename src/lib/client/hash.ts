// src/lib/client/hash.ts

/**
 * Content fingerprint used to spot re-uploads of the same file.
 *
 * Small files are hashed whole. Videos can run to hundreds of megabytes, and
 * pulling one into an ArrayBuffer to hash it would blow up a phone's memory —
 * so above the threshold we hash the size plus the head and tail. Two distinct
 * recordings sharing an exact byte length *and* identical first and last 4 MB
 * is not a scenario worth engineering for.
 *
 * The mode prefix keeps the two schemes in separate namespaces, so a full hash
 * can never collide with a sampled one.
 */

const FULL_HASH_LIMIT = 32 * 1024 * 1024;
const SAMPLE_BYTES = 4 * 1024 * 1024;

export async function contentHash(file: File): Promise<string> {
  if (file.size <= FULL_HASH_LIMIT) {
    return "f:" + (await sha256(await file.arrayBuffer()));
  }

  const head = await file.slice(0, SAMPLE_BYTES).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - SAMPLE_BYTES)).arrayBuffer();

  const sizeTag = new TextEncoder().encode(String(file.size));
  const combined = new Uint8Array(sizeTag.length + head.byteLength + tail.byteLength);
  combined.set(sizeTag, 0);
  combined.set(new Uint8Array(head), sizeTag.length);
  combined.set(new Uint8Array(tail), sizeTag.length + head.byteLength);

  return "s:" + (await sha256(combined.buffer as ArrayBuffer));
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
