/** File name from a path (last segment). */
export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Short label for long filenames: keep start + end (incl. extension).
 * Full path should stay available via `title` tooltips.
 */
export function truncateMiddle(name: string, maxLen = 42): string {
  if (name.length <= maxLen) return name;
  if (maxLen < 8) return name.slice(0, Math.max(0, maxLen));
  const keep = maxLen - 1; // room for …
  const head = Math.ceil(keep * 0.55);
  const tail = keep - head;
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}
