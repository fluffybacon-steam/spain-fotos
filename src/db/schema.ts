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

export const REACTION_KINDS = ["heart", "up", "meh", "down", "poo"] as const;
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
