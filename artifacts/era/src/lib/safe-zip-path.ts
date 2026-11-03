const RESERVED_SEGMENTS = new Set(["node_modules", ".git", "data", ".era", "dist"]);

/** Return a safe project-relative ZIP entry path, or null when it must be rejected. */
export function normalizeSafeZipPath(path: string): string | null {
  if (
    path.length === 0 ||
    path.length >= 180 ||
    !/^[a-zA-Z0-9_.\-/]+$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some(segment =>
      !segment || segment === "." || segment === ".." || RESERVED_SEGMENTS.has(segment),
    ) ||
    /(^|\/)\.env(?:$|\.(?!example$))/.test(path)
  ) {
    return null;
  }
  return path;
}
