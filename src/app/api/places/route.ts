// src/app/api/places/route.ts
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, places } from "@/db";
import { requireUser, guard } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guard(async () => {
  await requireUser();
  const rows = await db.select().from(places).orderBy(asc(places.name));
  return NextResponse.json({
    places: rows.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })),
  });
});

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const POST = guard(async (req: Request) => {
  const me = await requireUser();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the place a name" }, { status: 400 });

  const row = {
    id: nanoid(12),
    name: parsed.data.name,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
    createdBy: me.uid,
  };
  await db.insert(places).values(row);
  return NextResponse.json({ place: { id: row.id, name: row.name, lat: row.lat, lng: row.lng } });
});
