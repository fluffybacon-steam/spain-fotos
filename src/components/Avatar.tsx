// src/components/Avatar.tsx
export default function Avatar({
  url,
  name,
  size = 28,
  count,
}: {
  url: string | null;
  name: string;
  size?: number;
  /**
   * How many photos this person has contributed. Omit it where the number
   * isn't known — a photo's owner or a comment's author has content by
   * definition, so those call sites shouldn't have to look one up.
   *
   * Left undefined rather than defaulting to 1: "not known" and "has exactly
   * one" are different states, and only an explicit 0 desaturates.
   */
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
      data-count={count}
      className={`grid shrink-0 place-items-center rounded-full border border-hairline bg-hull-hi font-mono text-[10px] text-haze ${
        isGrayscale ? "grayscale" : ""
      }`}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}