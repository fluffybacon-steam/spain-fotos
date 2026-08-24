// src/db/schema.ts
import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  doublePrecision,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  avatarKey: text("avatar_key"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const photos = pgTable(
  "photos",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Three R2 objects per photo: untouched original, web-sized display JPEG, grid thumbnail.
    originalKey: text("original_key").notNull(),
    displayKey: text("display_key").notNull(),
    thumbKey: text("thumb_key").notNull(),

    // 'photo' | 'video'. Videos reuse displayKey/thumbKey for their poster
    // frame, so every read path that renders a still keeps working unchanged.
    mediaType: text("media_type").notNull().default("photo"),
    durationMs: integer("duration_ms"),

    /** SHA-256 fingerprint of the original bytes — see lib/client/hash.ts. */
    contentHash: text("content_hash"),

    originalName: text("original_name").notNull(),
    originalMime: text("original_mime").notNull(),
    originalBytes: bigint("original_bytes", { mode: "number" }).notNull(),

    width: integer("width").notNull(),
    height: integer("height").notNull(),

    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    // 'exif'  — read out of the file's GPS tags
    // 'manual' — the uploader dropped the pin by hand
    locationSource: text("location_source"),

    takenAt: timestamp("taken_at", { withTimezone: true }),
    cameraMake: text("camera_make"),
    cameraModel: text("camera_model"),
    caption: text("caption"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("photos_owner_idx").on(t.ownerId),
    index("photos_coords_idx").on(t.lat, t.lng),
    index("photos_taken_idx").on(t.takenAt),
    // Per-owner rather than global: two friends may legitimately both hold the
    // same photo, and each should keep their own attribution. What this stops
    // is one person uploading the same file twice.
    uniqueIndex("photos_owner_hash_idx").on(t.ownerId, t.contentHash),
  ],
);

/**
 * A spot someone has named. Photos aren't linked to these by foreign key —
 * a place is matched to a photo by proximity at read time, which means naming
 * a cove retroactively labels every photo already sitting in it.
 */
export const places = pgTable(
  "places",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("places_coords_idx").on(t.lat, t.lng)],
);

/** Flat comments — no threading, no mentions. Sorted oldest-first on read. */
export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    photoId: text("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_photo_idx").on(t.photoId, t.createdAt)],
);

/**
 * One person's private shortlist. Deliberately not a reaction: reactions are a
 * conversation — everyone sees the tally and who left what — whereas a favorite
 * is a bookmark. Nothing about this table is ever exposed to anyone but the
 * user who wrote the row, which is what lets people star freely (including
 * their own photos, and including the unflattering one they want to find again
 * to delete) without it reading as a public verdict.
 */
export const favorites = pgTable(
  "favorites",
  {
    photoId: text("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Starring twice is the same as starring once, so the pair is the key.
  (t) => [
    primaryKey({ columns: [t.photoId, t.userId] }),
    // Every read is "my favorites" — the primary key leads with photo_id and
    // can't serve that.
    index("favorites_user_idx").on(t.userId, t.createdAt),
  ],
);

export const REACTION_KINDS = ["heart", "laugh", "copycat", "wow", "cute", "meh", "poo"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const reactions = pgTable(
  "reactions",
  {
    photoId: text("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ReactionKind>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One reaction per person per photo. Changing your mind overwrites.
  (t) => [primaryKey({ columns: [t.photoId, t.userId] })],
);
