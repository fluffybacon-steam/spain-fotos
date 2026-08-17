"use client";
// src/components/TopBar.tsx

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PersonDTO } from "@/types";
import Avatar from "./Avatar";

/**
 * The coordinate readout tracks the map centre like an instrument panel. It is
 * the small thing that makes the app feel like a chart rather than a gallery,
 * and it is genuinely useful — it tells you which cove you're looking at.
 */
export default function TopBar({
  centre,
  people,
  unplacedCount,
  onShowUnplaced,
}: {
  centre: { lat: number; lng: number } | null;
  people: PersonDTO[];
  unplacedCount: number;
  onShowUnplaced: () => void;
}) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="glass absolute inset-x-2 top-2 z-30 flex items-center gap-3 rounded-[4px] px-3 py-2">
      <Link href="/" className="font-display text-lg font-extrabold leading-none tracking-tight">
        Cala
      </Link>

      <span className="coord hidden truncate sm:block">
        {centre ? `${format(centre.lat, "NS")}  ${format(centre.lng, "EW")}` : "—"}
      </span>

      <div className="flex-1" />

      {unplacedCount > 0 && (
        <button
          type="button"
          onClick={onShowUnplaced}
          className="reaction"
          title="Photos that arrived without location data"
        >
          <span className="glyph">📍</span>
          <span>{unplacedCount} unplaced</span>
        </button>
      )}

      <Link href="/people" className="hidden items-center -space-x-2 sm:flex" title="Everyone">
        {people.slice(0, 5).map((p) => (
          <Avatar key={p.id} url={p.avatarUrl} name={p.name} size={26} />
        ))}
      </Link>

      <Link href="/upload" className="btn btn-primary btn-sm">
        Add photos
      </Link>

      <button type="button" className="icon-btn icon-btn-sm" onClick={signOut} aria-label="Sign out">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 2.6H3.4v10.8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M9 5.2L11.8 8 9 10.8M11.6 8H6.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}

/** 39.5696° N — the way a chart would print it. */
function format(value: number, axis: "NS" | "EW") {
  const hemi = axis === "NS" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(4)}° ${hemi}`;
}
