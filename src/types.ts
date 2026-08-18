// src/types.ts
import type { ReactionKind } from "@/db/schema";

export type PhotoDTO = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  mediaType: "photo" | "video";
  durationMs: number | null;
  thumbUrl: string;
  displayUrl: string;
  originalUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  lat: number | null;
  lng: number | null;
  locationSource: string | null;
  takenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  caption: string | null;
  originalName: string;
  originalBytes: number;
  commentCount: number;
  reactions: Record<ReactionKind, number>;
  myReaction: ReactionKind | null;
};

export type CommentDTO = {
  id: string;
  photoId: string;
  userId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
};

export type PersonDTO = {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  photoCount: number;
};
