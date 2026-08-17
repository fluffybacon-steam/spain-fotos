// drizzle.config.ts
import "./scripts/load-env";
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: requireEnv("DATABASE_URL") },
} satisfies Config;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  ${name} is not set. Add it to .env, then re-run.\n`);
    process.exit(1);
  }
  return value;
}
