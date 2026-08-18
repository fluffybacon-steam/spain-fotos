"use client";
// src/components/EmojiSky.tsx

import { useEffect, useState } from "react";

/**
 * Weighted so the trip's everyday things — the cava, the olives, the paella,
 * the boat — form the steady drift, and the wedding turns up as an occasional
 * event rather than a motif. A flat list would make brides as common as the
 * sun, which reads as noise instead of a nod.
 */
const CAST: { glyph: string; weight: number }[] = [
  { glyph: "🍾", weight: 3 },
  { glyph: "🫒", weight: 3 },
  { glyph: "🌞", weight: 3 },
  { glyph: "🥘", weight: 3 },
  { glyph: "🇪🇸", weight: 3 },
  { glyph: "🛥️", weight: 3 },
  { glyph: "👯", weight: 2 },
  { glyph: "⛪", weight: 2 },
  { glyph: "👰‍♀️", weight: 1 },
  { glyph: "👰‍♂️", weight: 1 },
];

const POOL = CAST.flatMap(({ glyph, weight }) => Array<string>(weight).fill(glyph));

type Piece = {
  key: number;
  glyph: string;
  style: React.CSSProperties;
};

function between(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function build(count: number): Piece[] {
  // Stratified rather than uniform. Pure Math.random() on the X axis reliably
  // clumps three pieces together and leaves a bare column somewhere else. One
  // piece per vertical band, jittered inside its band, gives even coverage
  // that still doesn't look like a grid.
  const band = 96 / count;

  return Array.from({ length: count }, (_, key) => {
    const fall = between(11, 21);

    return {
      key,
      glyph: POOL[Math.floor(Math.random() * POOL.length)],
      style: {
        "--x": `${(2 + key * band + Math.random() * band * 0.85).toFixed(2)}%`,
        "--size": `${between(1.05, 2.35).toFixed(2)}rem`,
        // Kept low: this is background weather, and the sign-in form has to
        // stay the thing your eye lands on.
        "--fade": between(0.8, 1).toFixed(2),
        "--fall": `${fall.toFixed(2)}s`,
        "--drift": `${between(14, 46).toFixed(0)}px`,
        // One or two whole turns, either direction. Whole turns keep the loop
        // seamless; the sign is what stops every piece rotating in unison.
        "--spin": `${(Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 360 : 720)}deg`,
        "--spin-time": `${between(4.5, 11).toFixed(2)}s`,
        // Negative, so every piece is already mid-descent on the first frame.
        // A positive delay would open on an empty screen for ten seconds.
        "--offset": `${(-Math.random() * fall).toFixed(2)}s`,
      } as React.CSSProperties,
    };
  });
}

/**
 * Decorative only, so it's hidden from assistive tech and never receives
 * pointer events.
 *
 * Built in an effect rather than during render because the positions are
 * random: generating them on the server would guarantee a hydration mismatch.
 * The cost is one frame with an empty sky, which nobody sees.
 */
export default function EmojiSky() {
  const [pieces, setPieces] = useState<Piece[]>([]);

  useEffect(() => {
    // Fewer on a phone — same visual density in a narrower column, less work
    // for a mobile compositor.
    const count = window.innerWidth < 640 ? 14 : 22;
    setPieces(build(count));
  }, []);

  return (
    <div className="emoji-sky" aria-hidden="true">
      {pieces.map(({ key, glyph, style }) => (
        <div key={key} className="emoji-piece" style={style}>
          <span>{glyph}</span>
        </div>
      ))}
    </div>
  );
}
