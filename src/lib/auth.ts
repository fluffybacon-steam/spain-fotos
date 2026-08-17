// src/lib/auth.ts
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (
  pw: string,
  salt: Buffer,
  len: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// N=2^15 keeps login well under a second on Vercel's Node runtime while
// staying expensive enough to make an offline crack of a leaked hash painful.
const PARAMS = { N: 32768, r: 8, p: 1 };
const KEYLEN = 64;

/**
 * scrypt allocates 128 * N * r bytes and Node caps that at 32 MiB unless told
 * otherwise. These parameters need exactly 32 MiB, and the check is strictly
 * greater-than, so the default rejects them by a single byte. Compute the
 * ceiling from the parameters rather than hard-coding it, so tuning N or r
 * later can't quietly reintroduce the same failure.
 */
function maxmemFor(N: number, r: number) {
  return Math.max(32 * 1024 * 1024, 128 * N * r * 2);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    ...PARAMS,
    maxmem: maxmemFor(PARAMS.N, PARAMS.r),
  });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(keyB64, "base64url");
    // Parameters come from the stored hash, so the memory ceiling has to be
    // derived from them too — not from the current PARAMS constant.
    const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: maxmemFor(Number(N), Number(r)),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Readable, unambiguous passwords you can dictate over a phone call.
// No 0/O, no 1/l/I. Four words of four characters.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function generatePassword(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
