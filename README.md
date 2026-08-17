# Cala

A private photo map for one trip and one group of friends. Everyone signs in with an account you made for them, uploads straight from their camera roll, and the photos land on a map wherever the camera recorded them. Works the same on iOS and Android because it's a website, not an app.

---

## How it fits together

```
phone browser                      Vercel (Next.js)              Cloudflare R2
─────────────                      ────────────────              ─────────────
pick files
  │
  ├─ read EXIF from original ──────────────────────────────────► (never leaves the device)
  ├─ HEIC → JPEG (libheif/wasm)
  ├─ resize → display + thumb
  │
  ├─ POST /api/uploads/presign ───► sign 3 PUT URLs ────────────►
  ├─ PUT original ─────────────────────────────────────────────► photos/{user}/{id}/original.heic
  ├─ PUT display  ─────────────────────────────────────────────► photos/{user}/{id}/display.jpg
  ├─ PUT thumb    ─────────────────────────────────────────────► photos/{user}/{id}/thumb.jpg
  └─ POST /api/photos ───────────► write row (Neon Postgres)

viewing
  └─ GET /api/img/{id}/thumb ────► check session, 307 ──────────► presigned GET (1 h)
```

Three design decisions worth knowing before you change anything:

**EXIF is read in the browser, on the untouched file.** Every transform — HEIC decode, canvas resize, even some upload paths — destroys GPS tags. Reading them first is the only reliable way to get photos onto the map at all.

**Uploads never pass through the server.** Vercel caps request bodies at 4.5 MB and a modern phone photo is routinely three times that. Presigned PUT straight to R2 is the only thing that works, and it's also free of Vercel bandwidth charges.

**The bucket stays private.** `/api/img/[id]/[variant]` checks the session and redirects to a one-hour presigned URL, with the redirect privately cached for 55 minutes. One extra hop per image per hour, and no public bucket to leak.

---

## Setup

### 1. Database — Neon

Create a project at [neon.tech](https://neon.tech), pick an EU region if your friends are in Europe, and copy the pooled connection string.

```bash
cp .env.example .env
# paste DATABASE_URL, then:
npm install
npm run db:push
```

### 2. Storage — Cloudflare R2

Create a bucket (`cala-photos`), then an R2 API token with **Object Read & Write** scoped to it. Put the account ID, access key, secret and bucket name in `.env`. That scope is all the running app ever needs.

Browser uploads then need a CORS policy, without which every `PUT` fails the preflight. Setting one is an *admin*-scoped operation, so the app's own token deliberately can't do it. Use the dashboard:

**R2 → your bucket → Settings → CORS Policy → Edit**

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://your-domain.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`AllowedHeaders` must include `content-type`: the upload signature covers that header, so the browser has to be allowed to send it on a preflighted `PUT`.

If you'd rather script it, `npm run r2:cors -- https://your-domain.com` does the same thing, but needs a temporary **Admin Read & Write** token. Delete it afterwards.

### 3. Maps — Google Cloud

Enable **Maps JavaScript API**. Then:

- Create an API key and restrict it by **HTTP referrer** to `localhost:3000/*` and your domain. The key ships to the browser by design; the referrer restriction is what protects it.
- Create a **Map ID** (Maps → Map management, type *JavaScript*, **vector**). `AdvancedMarkerElement` will not render without one.

Set both `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`.

### 4. Session secret

```bash
openssl rand -base64 48
```

### 5. Accounts

No sign-up page exists. You mint each account and pass on the password yourself:

```bash
npm run user:add -- alba "Alba Ruiz" ./avatars/alba.jpg
npm run user:add -- tom "Tom Byrne"
npm run user:list
npm run user:passwd -- tom     # if someone loses theirs
```

Passwords are four four-character groups from an alphabet with no `0/O` or `1/l/I`, so they survive being read aloud over a bad phone line. They're hashed with scrypt and never stored in readable form — a reset issues a new one rather than recovering the old.

### 6. Deploy

```bash
vercel
```

Copy every variable from `.env` into the Vercel project settings, then re-run `npm run r2:cors` with the production domain.

Tell everyone to open the site and use **Add to Home Screen** — the manifest makes it launch full-screen like an app on both platforms.

---

## Getting photos to actually land on the map

This is the part that goes wrong, and it goes wrong on the phone rather than in the code.

| Situation | Has GPS? |
|---|---|
| Picked from the camera roll, original file | Yes |
| Forwarded through WhatsApp / Telegram / Signal | **No** — re-encoded, tags stripped |
| Saved from a Google Photos share link | **No** |
| Screenshot, scan, or anything AirDropped after editing | **No** |
| Camera location permission was off when shot | **No** |

For anything that arrives without coordinates, the top bar shows an **unplaced** count. Tapping it opens the place picker, which offers three routes in order of effort:

1. **Best guess from the timestamp.** Stripping GPS and stripping the capture time are different operations — a forwarded photo usually keeps a usable time, and you were somewhere specific at that moment. If a located photo was taken within 30 minutes, the picker offers its position and always shows the gap, because `takenAt` falls back to file mtime and for a forwarded image that's when it was *received*. A visible "3 min apart" is trustworthy; "22 min apart" invites a second look.
2. **Spots from the trip.** Located photos are clustered at a 180 m radius — about one cove or one square, comfortably wider than consumer GPS error — and offered as a list with a thumbnail and photo count. This is the shortcut for "these forty shots are all from that beach".
3. **Drop a pin**, as before.

Selection is multiple by default, so a whole afternoon of forwarded photos goes in one action rather than forty.

Anything placed by hand is stored as `locationSource: 'manual'` and labelled in the viewer, so nobody later mistakes a guess for a measurement.

### Naming places

After placing photos somewhere with no named spot nearby, you're offered the chance to name it. Names live in the `places` table and are matched to photos **by proximity at read time** rather than by foreign key — so naming a cove retroactively labels every photo already sitting in it, including ones placed by EXIF months earlier. Naming is always optional; skipping leaves plain coordinates.

**Who may place what:** anyone in the trip can place a photo that has *no* location, because the group often remembers where a shot was taken when its owner doesn't. Only the owner can move one that's already placed, so a real GPS reading can't be overwritten by someone else's guess.

---

## Interface notes

The map *is* the page. Photos are their own map pins rather than dots with a thumbnail inside; clusters render as a physical stack of prints with a count. Clicking a cluster opens the grid instead of zooming in — at a beach where forty photos share one GPS fix, zooming never separates them, which is the flaw in the default clusterer behaviour.

Everything measured rather than written — coordinates, timestamps, file sizes, reaction counts — is set in mono. The readout in the top bar tracks the map centre.

Reactions are ❤️ 👍 😐 👎 💩, one per person per photo; tapping your current one clears it. They update optimistically and roll back if the write fails.

---

## Things worth knowing before you extend this

**Sessions are stateless JWTs.** There's no server-side session table, so `npm run user:passwd` does not kick an existing session off a device. If you need instant revocation, add a `tokenVersion` column to `users`, put it in the token, and check it in `readSession`. For a friends trip the trade was worth it; for anything wider it isn't.

**`heic-to` needs `wasm-unsafe-eval`.** If you add a Content-Security-Policy later, keep that in `script-src` or HEIC conversion breaks with no obvious error.

**Everyone can see everything.** There is deliberately no per-photo visibility model. Only the uploader (or an admin) can delete a photo.

**Orphaned objects.** If a browser dies mid-upload, the R2 objects exist without a database row. Harmless and cheap, but a periodic sweep comparing `photos/` prefixes against the `photos` table would clean them up.

**HEIC decoding is the slow step**, roughly 1–3 seconds per photo on a mid-range phone. Two files are processed at a time to avoid exhausting memory on large bursts. If you want it faster, move `preparePhoto` into a Web Worker pool — the code is already free of DOM dependencies apart from the canvas fallback.

**Standalone scripts load `.env` themselves.** `next dev` and `drizzle-kit` both read `.env` automatically, but the `tsx` scripts (`user:add`, `r2:cors`) are plain Node processes and don't. They import `scripts/load-env.ts` for that, which uses Node's built-in loader with a small parser as a fallback. If you add another script, import it first or your credentials will be silently undefined.

**Auth lives in `src/proxy.ts`.** Next 16 renamed the `middleware` file convention to `proxy`; the exported function is `proxy`, not `middleware`. The behaviour is identical.

**`/api/photos/location` shadows `/api/photos/[id]`** for that one literal segment. Next resolves static routes before dynamic ones, so this is correct — but it means a photo whose id was the string `location` would be unreachable. nanoid never generates it; just don't hand-write ids.

**Verify the dependency versions.** `package.json` pins reasonable ranges, but run `npm outdated` after install — a few of these move quickly.
