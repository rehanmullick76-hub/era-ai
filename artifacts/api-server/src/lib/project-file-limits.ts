export const MAX_PROJECT_FILE_BYTES = 500_000;
export const MAX_PROJECT_FILES = 100;
export const MAX_PROJECT_SOURCE_BYTES = 1_000_000;

export function getProjectFileViolation(
  file: { path: string; content: string },
  isSafePath: (path: string) => boolean,
): string | null {
  if (!isSafePath(file.path)) {
    return `Use a safe relative project file path for ${file.path}.`;
  }
  if (Buffer.byteLength(file.content, "utf8") > MAX_PROJECT_FILE_BYTES) {
    return `${file.path} exceeds the ${MAX_PROJECT_FILE_BYTES}-byte project file limit.`;
  }
  return null;
}

export function projectFileUsageAfterUpsert(
  files: readonly { path: string; content: string }[],
  path: string,
  content: string,
): { fileCount: number; totalBytes: number; fileBytes: number } {
  const fileBytes = Buffer.byteLength(content, "utf8");
  const previous = files.find(file => file.path === path);
  return {
    fileCount: files.length + (previous ? 0 : 1),
    totalBytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0) -
      (previous ? Buffer.byteLength(previous.content, "utf8") : 0) + fileBytes,
    fileBytes,
  };
}

export function isProjectFileUsageWithinLimits(
  usage: { fileCount: number; totalBytes: number },
  maxFiles = MAX_PROJECT_FILES,
  maxBytes = MAX_PROJECT_SOURCE_BYTES,
): boolean {
  return usage.fileCount <= maxFiles && usage.totalBytes <= maxBytes;
}
