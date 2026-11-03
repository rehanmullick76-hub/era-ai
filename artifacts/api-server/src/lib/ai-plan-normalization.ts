export interface PlannedFile {
  path: string;
  description: string;
  language: string;
}

function inferPlannedLanguage(path: string): string {
  if (/\.html?$/i.test(path)) return "html";
  if (/\.css$/i.test(path)) return "css";
  if (/\.(?:js|mjs|cjs|ts|tsx)$/i.test(path)) return "javascript";
  if (/\.sql$/i.test(path)) return "sql";
  if (/\.json$/i.test(path)) return "json";
  if (/\.md$/i.test(path)) return "markdown";
  return "markdown";
}

/** Coerce model output to the strict API response shape before Zod validation. */
export function normalizePlanFiles(value: unknown): PlannedFile[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): PlannedFile[] => {
    if (typeof item === "string") {
      const path = item.trim();
      if (!path) return [];
      return [{
        path,
        description: `Project file: ${path}.`,
        language: inferPlannedLanguage(path),
      }];
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.path !== "string" || !candidate.path.trim()) return [];

    const path = candidate.path.trim();
    return [{
      path,
      description: typeof candidate.description === "string" && candidate.description.trim()
        ? candidate.description.trim()
        : `Project file: ${path}.`,
      language: typeof candidate.language === "string" && candidate.language.trim()
        ? candidate.language.trim()
        : inferPlannedLanguage(path),
    }];
  });
}
