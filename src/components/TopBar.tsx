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
        Spain Fotos
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
          <span className="glyph"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M480-80Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q10 0 19.5.5T520-877v81q-10-2-20-3t-20-1q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186q122-112 181-203.5T720-552q0-2-.5-4t-.5-4h80q0 2 .5 4t.5 4q0 100-79.5 217.5T480-80Zm0-450Zm195-108 84-84 84 84 56-56-84-84 84-84-56-56-84 84-84-84-56 56 84 84-84 84 56 56ZM536.5-503.5Q560-527 560-560t-23.5-56.5Q513-640 480-640t-56.5 23.5Q400-593 400-560t23.5 56.5Q447-480 480-480t56.5-23.5Z"/></svg></span>
          <span>{unplacedCount}</span>
        </button>
      )}

      <Link href="/browse" className="hidden items-center -space-x-2 sm:flex" title="Browse everyone\u2019s photos">
        {people.slice(0, 5).map((p) => (
          <Avatar key={p.id} url={p.avatarUrl} name={p.name} size={26} count={p.photoCount}/>
        ))}
      </Link>

      <Link href="/browse" className="btn btn-quiet btn-sm sm:hidden">
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M360-400h400L622-580l-92 120-62-80-108 140Zm-40 160q-33 0-56.5-23.5T240-320v-480q0-33 23.5-56.5T320-880h480q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H320Zm0-80h480v-480H320v480ZM160-80q-33 0-56.5-23.5T80-160v-560h80v560h560v80H160Zm160-720v480-480Z"/></svg>
      </Link>

      <Link href="/upload" className="btn btn-primary btn-sm">
        Add photos
      </Link>

      {/* <button type="button" className="icon-btn icon-btn-sm" onClick={signOut} aria-label="Sign out">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 2.6H3.4v10.8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M9 5.2L11.8 8 9 10.8M11.6 8H6.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button> */}
    </header>
  );
}

/** 39.5696° N — the way a chart would print it. */
function format(value: number, axis: "NS" | "EW") {
  const hemi = axis === "NS" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(4)}° ${hemi}`;
}
