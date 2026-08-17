// src/app/api/me/route.ts
import { NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { db, users, photos } from "@/db";
import { requireUser, guard } from "@/lib/session";
import type { PersonDTO } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guard(async () => {
  const me = await requireUser();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      avatarKey: users.avatarKey,
      photoCount: sql<number>`cast(count(${photos.id}) as int)`,
    })
    .from(users)
    .leftJoin(photos, eq(photos.ownerId, users.id))
    .groupBy(users.id, users.name, users.username, users.avatarKey)
    .orderBy(asc(users.name));

  const people: PersonDTO[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username,
    avatarUrl: r.avatarKey ? `/api/img/${r.id}/avatar` : null,
    photoCount: r.photoCount,
  }));

  return NextResponse.json({ me, people });
});
