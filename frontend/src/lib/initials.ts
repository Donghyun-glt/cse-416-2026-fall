/**
 * Up to two initials for an avatar: the first letter or digit of each of the first two
 * words that have one. Words made only of emoji or symbols ("📕", "-") are skipped, and
 * whole characters are taken, so an emoji is never cut in half into a broken glyph.
 */
export function initials(value: string, fallback = "M") {
  const letters = value.split(/\s+/).flatMap((word) => {
    const first = word.match(/[\p{L}\p{N}]/u)?.[0];
    return first ? [first.toLocaleUpperCase()] : [];
  });
  return letters.slice(0, 2).join("") || fallback;
}
