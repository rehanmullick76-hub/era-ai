export interface FileEdit {
  find: string;
  replace: string;
}

export type ParsedGeneratedFile = {
  path: string;
  action: "create" | "update" | "delete" | "patch";
  content?: string;
  language?: string;
  edits?: FileEdit[];
  invalidPatch?: boolean;
};

export type ResolvedGeneratedFile = {
  path: string;
  content: string;
  language: string;
  action: "create" | "update" | "delete";
};

export interface ExistingProjectFile {
  path: string;
  content: string;
  language?: string;
}

export function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "html",
    css: "css",
    js: "javascript",
    ts: "typescript",
    json: "json",
    md: "markdown",
    svg: "svg",
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

export function normalizeGeneratedFilePath(path: string): string {
  return path.trim().replace(/^(?:\.\/)+|^\/+/, "");
}

/**
 * Reject an entire patch if any edit is malformed. Silently dropping one edit
 * could apply an incomplete patch while appearing successful.
 */
export function normalizePatchFile(item: Record<string, unknown>): ParsedGeneratedFile | null {
  if (item.action !== "patch" || typeof item.path !== "string") return null;
  const cleanPath = normalizeGeneratedFilePath(item.path);
  if (!cleanPath) return null;
  const invalidPatch = (): ParsedGeneratedFile => ({
    path: cleanPath,
    action: "patch",
    edits: [],
    language: inferLanguage(cleanPath),
    invalidPatch: true,
  });
  if (!Array.isArray(item.edits) || item.edits.length === 0) return invalidPatch();

  const edits: FileEdit[] = [];
  for (const rawEdit of item.edits) {
    if (!rawEdit || typeof rawEdit !== "object") return invalidPatch();
    const edit = rawEdit as Record<string, unknown>;
    if (typeof edit.find !== "string" || !edit.find.trim() || typeof edit.replace !== "string") {
      return invalidPatch();
    }
    edits.push({ find: edit.find, replace: edit.replace });
  }

  return {
    path: cleanPath,
    action: "patch",
    edits,
    language: inferLanguage(cleanPath),
  };
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const index = text.indexOf(needle, from);
    if (index === -1) return count;
    count++;
    from = index + 1;
  }
}

function normalizeWhitespaceWithMap(text: string): { normalized: string; ranges: [number, number][] } {
  let normalized = "";
  const ranges: [number, number][] = [];
  let whitespaceStart = -1;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (normalized && whitespaceStart === -1) whitespaceStart = i;
      continue;
    }
    if (whitespaceStart !== -1) {
      normalized += " ";
      ranges.push([whitespaceStart, i]);
      whitespaceStart = -1;
    }
    normalized += text[i];
    ranges.push([i, i + 1]);
  }
  return { normalized, ranges };
}

function applyUniqueEdit(content: string, edit: FileEdit): string | null {
  const exactMatches = countOccurrences(content, edit.find);
  if (exactMatches === 1) {
    const index = content.indexOf(edit.find);
    return content.slice(0, index) + edit.replace + content.slice(index + edit.find.length);
  }
  if (exactMatches > 1) return null;

  const source = normalizeWhitespaceWithMap(content);
  const search = edit.find.replace(/\s+/g, " ").trim();
  if (!search) return null;
  const normalizedMatches = countOccurrences(source.normalized, search);
  if (normalizedMatches !== 1) return null;
  const index = source.normalized.indexOf(search);
  const start = source.ranges[index]?.[0];
  const end = source.ranges[index + search.length - 1]?.[1];
  if (start === undefined || end === undefined) return null;
  return content.slice(0, start) + edit.replace + content.slice(end);
}

export function resolvePatches(
  generated: ParsedGeneratedFile[],
  originals: ExistingProjectFile[],
): { files: ResolvedGeneratedFile[]; failedPatches: ParsedGeneratedFile[] } {
  const files: ResolvedGeneratedFile[] = [];
  const failedPatches: ParsedGeneratedFile[] = [];
  const pathCounts = new Map<string, number>();
  for (const file of generated) {
    pathCounts.set(file.path, (pathCounts.get(file.path) ?? 0) + 1);
  }
  const duplicatePatchPaths = new Set(
    generated
      .filter(file => file.action === "patch" && (pathCounts.get(file.path) ?? 0) > 1)
      .map(file => file.path),
  );

  for (const file of generated) {
    if (duplicatePatchPaths.has(file.path)) {
      if (file.action === "patch") failedPatches.push(file);
      continue;
    }
    if (file.action === "patch") {
      if (file.invalidPatch || !file.edits?.length) {
        failedPatches.push(file);
        continue;
      }
      const original = originals.find(candidate => candidate.path === file.path);
      if (!original) {
        failedPatches.push(file);
        continue;
      }
      let content = original.content;
      let failed = false;
      for (const edit of file.edits ?? []) {
        if (failed) break;
        const next = applyUniqueEdit(content, edit);
        if (next === null) {
          failed = true;
          break;
        }
        content = next;
      }
      if (failed) {
        failedPatches.push(file);
        continue;
      }
      files.push({
        path: file.path,
        content,
        language: original.language || file.language || inferLanguage(file.path),
        action: "update",
      });
    } else {
      files.push({
        path: file.path,
        content: file.action === "delete" ? "" : file.content ?? "",
        language: file.language || inferLanguage(file.path),
        action: file.action,
      });
    }
  }
  return { files, failedPatches };
}

export function buildPatchFallbackPlan(
  failedPatches: ParsedGeneratedFile[],
  originals: ExistingProjectFile[],
): { paths: string[]; filesContext: string; expectedActions: Map<string, "create" | "update"> } {
  const paths = [...new Set(failedPatches.map(file => file.path))];
  const expectedActions = new Map<string, "create" | "update">();
  const filesContext = paths.map(path => {
    const original = originals.find(file => file.path === path);
    const action = original ? "update" : "create";
    expectedActions.set(path, action);
    return `=== ${path} (action: ${action}) ===\n${original?.content ?? "(No existing file content; create a complete file.)"}`;
  }).join("\n\n");
  return { paths, filesContext, expectedActions };
}

export function selectPatchFallbackUpdates(
  candidates: ParsedGeneratedFile[],
  failedPaths: string[],
  expectedActions: Map<string, "create" | "update"> = new Map(failedPaths.map(path => [path, "update"])),
): Map<string, ParsedGeneratedFile & { action: "create" | "update"; content: string; language: string }> {
  const allowedPaths = new Set(failedPaths);
  const updates = new Map<string, ParsedGeneratedFile & {
    action: "create" | "update";
    content: string;
    language: string;
  }>();
  const ambiguousPaths = new Set<string>();

  for (const file of candidates) {
    if (
      file.action !== expectedActions.get(file.path) ||
      typeof file.content !== "string" ||
      typeof file.language !== "string" ||
      !allowedPaths.has(file.path)
    ) {
      continue;
    }
    if (updates.has(file.path)) {
      ambiguousPaths.add(file.path);
    } else {
      updates.set(file.path, file as ParsedGeneratedFile & {
        action: "create" | "update";
        content: string;
        language: string;
      });
    }
  }

  for (const path of ambiguousPaths) updates.delete(path);
  return updates;
}
