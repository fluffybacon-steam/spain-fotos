"use client";
// src/components/ReactionBar.tsx

import { useState } from "react";
import type { ReactionKind } from "@/db/schema";
import type { PhotoDTO } from "@/types";

export const REACTIONS: { kind: ReactionKind; glyph: string; label: string }[] = [
  { kind: "heart", glyph: "❤️", label: "Love it" },
  { kind: "laugh", glyph:"😂", label: "Very Funny" },
  { kind: "up", glyph: "👍", label: "Good one" },
  { kind: "meh", glyph: "😐", label: "Fine" },
  { kind: "down", glyph: "👎", label: "Not great" },
  { kind: "poo", glyph: "💩", label: "Delete this" },
];

export default function ReactionBar({
  photo,
  onChange,
}: {
  photo: PhotoDTO;
  onChange: (updated: PhotoDTO) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function react(kind: ReactionKind) {
    if (busy) return;
    // Tapping your current reaction clears it.
    const next = photo.myReaction === kind ? null : kind;

    const tally = { ...photo.reactions };
    if (photo.myReaction) tally[photo.myReaction] = Math.max(0, tally[photo.myReaction] - 1);
    if (next) tally[next] = (tally[next] ?? 0) + 1;

    const optimistic = { ...photo, reactions: tally, myReaction: next };
    onChange(optimistic);
    setBusy(true);

    try {
      const res = await fetch(`/api/photos/${photo.id}/reaction`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      onChange(photo); // roll back to what the server still believes
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {REACTIONS.map(({ kind, glyph, label }) => {
        const count = photo.reactions[kind] ?? 0;
        const mine = photo.myReaction === kind;
        return (
          <button
            key={kind}
            type="button"
            className="reaction"
            data-mine={mine}
            aria-pressed={mine}
            aria-label={`${label}${count ? ` (${count})` : ""}`}
            onClick={() => react(kind)}
          >
            <span className="glyph">{glyph}</span>
            {count > 0 && <span>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
