// src/components/Avatar.tsx
export default function Avatar({
  url,
  name,
  size = 28,
  count = 1,
}: {
  url: string | null;
  name: string;
  size?: number;
  count?: number;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const isGrayscale = count === 0;

  return url ? (
    <img
      src={url}
      alt={name}
      width={size}
      height={size}
      data-count={count}
      className={`shrink-0 rounded-full border border-hairline object-cover ${
        isGrayscale ? "grayscale" : ""
      }`}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full border border-hairline bg-hull-hi font-mono text-[10px] text-haze ${
        isGrayscale ? "grayscale" : ""
      }`}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}