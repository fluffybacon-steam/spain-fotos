// scripts/manage-users.ts
/**
 * Account admin. There is deliberately no sign-up page — you create every
 * account here and hand the password to the person yourself.
 *
 *   npm run user:add    -- alba "Alba Ruiz" ./avatars/alba.jpg
 *   npm run user:list
 *   npm run user:passwd -- alba
 */
import "./load-env";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema";
import { hashPassword, generatePassword } from "../src/lib/auth";
import { r2, BUCKET } from "../src/lib/r2";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function add(username: string, name: string, avatarPath?: string) {
  if (!username || !name) {
    console.error('Usage: npm run user:add -- <username> "<Full Name>" [avatar.jpg]');
    process.exit(1);
  }

  const id = nanoid(12);
  const password = generatePassword();
  let avatarKey: string | null = null;

  if (avatarPath) {
    const ext = extname(avatarPath).toLowerCase();
    const contentType = MIME[ext];
    if (!contentType) {
      console.error(`Unsupported avatar type "${ext}". Use jpg, png, webp or gif.`);
      process.exit(1);
    }
    avatarKey = `avatars/${id}${ext}`;
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: avatarKey,
        Body: await readFile(avatarPath),
        ContentType: contentType,
      }),
    );
    console.log(`  uploaded ${basename(avatarPath)}`);
  }

  await db.insert(users).values({
    id,
    username: username.trim().toLowerCase(),
    name: name.trim(),
    passwordHash: await hashPassword(password),
    avatarKey,
  });

  console.log("\n  Account created — send these two lines and nothing else:\n");
  console.log(`    name:     ${username.trim().toLowerCase()}`);
  console.log(`    password: ${password}\n`);
  console.log("  This password is not stored anywhere in readable form.\n");
}

async function list() {
  const rows = await db.select().from(users).orderBy(asc(users.name));
  if (!rows.length) return console.log("No accounts yet.");
  for (const u of rows) {
    console.log(`  ${u.username.padEnd(16)} ${u.name.padEnd(24)} ${u.avatarKey ? "avatar" : "—"}`);
  }
}

async function passwd(username: string) {
  if (!username) {
    console.error("Usage: npm run user:passwd -- <username>");
    process.exit(1);
  }
  const password = generatePassword();
  const updated = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.username, username.trim().toLowerCase()))
    .returning({ username: users.username });

  if (!updated.length) {
    console.error(`No account called "${username}".`);
    process.exit(1);
  }
  console.log(`\n  New password for ${username}: ${password}\n`);
}

const [command, ...args] = process.argv.slice(2);
const run =
  command === "add"
    ? add(args[0], args[1], args[2])
    : command === "list"
      ? list()
      : command === "passwd"
        ? passwd(args[0])
        : Promise.reject(new Error(`Unknown command "${command}". Use add, list or passwd.`));

run.catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
