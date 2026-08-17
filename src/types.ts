// src/types.ts
import type { ReactionKind } from "@/db/schema";

export type PhotoDTO = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  thumbUrl: string;
  displayUrl: string;
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
  reactions: Record<ReactionKind, number>;
  myReaction: ReactionKind | null;
};

export type PersonDTO = {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  photoCount: number;
};
