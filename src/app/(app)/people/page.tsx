// src/app/(app)/people/page.tsx
import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db, users, photos } from "@/db";
import Avatar from "@/components/Avatar";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      avatarKey: users.avatarKey,
      count: sql<number>`cast(count(${photos.id}) as int)`,
    })
    .from(users)
    .leftJoin(photos, eq(photos.ownerId, users.id))
    .groupBy(users.id, users.name, users.username, users.avatarKey)
    .orderBy(asc(users.name));

  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{total} photos between everyone</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Who was there</h1>
        </div>
        <Link href="/" className="btn btn-quiet btn-sm">
          Map
        </Link>
      </div>

      <ul className="flex flex-col gap-1.5">
        {rows.map((person) => (
          <li
            key={person.id}
            className="flex items-center gap-3 rounded-[3px] border border-hairline bg-hull px-3 py-2.5"
          >
            <Avatar url={person.avatarKey ? `/api/img/${person.id}/avatar` : null} name={person.name} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{person.name}</p>
              <p className="coord">@{person.username}</p>
            </div>
            <p className="coord">{person.count}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
