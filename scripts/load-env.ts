// scripts/load-env.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Next.js reads .env by itself, but drizzle-kit and the tsx scripts don't —
 * they're plain Node processes. Import this for its side effect at the top of
 * anything that runs outside `next dev`.
 *
 * No dotenv dependency: Node has had a built-in loader since 20.12, with a
 * small parser here as a fallback for older runtimes.
 */
function loadEnvFile(file: string) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return false;

  const native = (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof native === "function") {
    native(path);
    return true;
  }

  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip one matching pair of surrounding quotes, as .env.example uses.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Real environment variables win, so `DATABASE_URL=... npm run db:push`
    // still overrides the file.
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

// .env.local first, matching Next's precedence, then .env.
loadEnvFile(".env.local");
const found = loadEnvFile(".env");

if (!found && !process.env.DATABASE_URL) {
  console.error(
    "\n  No .env file found in this directory.\n" +
      "  Copy the template and fill it in:  cp .env.example .env\n",
  );
}
