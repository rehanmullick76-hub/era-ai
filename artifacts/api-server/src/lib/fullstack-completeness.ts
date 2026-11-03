import type { ResolvedGeneratedFile } from "./patchSafety";
import { validateWorkspaceSource } from "./workspace-policy";

type SourceFile = { path: string; content: string };
type Repair = (missingPaths: string[], source: SourceFile[]) => Promise<ResolvedGeneratedFile[]>;
type MigrationRepair = (
  issue: string,
  generated: ResolvedGeneratedFile[],
  source: SourceFile[],
) => Promise<ResolvedGeneratedFile[]>;
const migrationPath = /^migrations\/[a-zA-Z0-9_-]+\.sql$/;

function isMigrationPolicyError(error: unknown): error is Error {
  return error instanceof Error &&
    /^(?:Unsafe migration:|Unsupported migration\.)/.test(error.message);
}

function mergeSource(existing: SourceFile[], generated: ResolvedGeneratedFile[]): SourceFile[] {
  const merged = new Map(existing.map(file => [file.path, file]));
  for (const file of generated) {
    if (file.action === "delete") merged.delete(file.path);
    else {
      if (typeof file.content !== "string") throw new Error(`Generated file ${file.path} is missing its content.`);
      merged.set(file.path, { path: file.path, content: file.content });
    }
  }
  return [...merged.values()];
}

/** One bounded source repair for omissions or unsafe generated migrations. */
export async function ensureFullstackCompleteness(
  generated: ResolvedGeneratedFile[],
  existing: SourceFile[],
  repair: Repair,
  repairMigration?: MigrationRepair,
): Promise<ResolvedGeneratedFile[]> {
  // A plain greeting/question is a valid response and has no workspace source
  // to validate or repair.
  if (generated.length === 0) return generated;

  const source = mergeSource(existing, generated);
  try {
    validateWorkspaceSource(source);
    return generated;
  } catch (error) {
    if (isMigrationPolicyError(error) && repairMigration) {
      const corrections = await repairMigration(error.message, generated, source);
      if (corrections.length === 0) {
        throw new Error("Migration repair returned no corrected files. Existing files and data were preserved.");
      }
      const originalChanges = new Map(
        generated.filter(file => !migrationPath.test(file.path)).map(file => [file.path, file]),
      );
      const originalPaths = new Set(existing.map(file => file.path));
      const seen = new Set<string>();
      for (const file of corrections) {
        if (seen.has(file.path)) {
          throw new Error("Migration repair returned duplicate file paths. No files were saved.");
        }
        seen.add(file.path);
        if (migrationPath.test(file.path)) {
          // A repair may add/replace a migration generated in this unsaved
          // batch, but must never rewrite a migration already in the project.
          if (file.action !== "create" || originalPaths.has(file.path)) {
            throw new Error("Migration repair may only create new numbered migrations. Existing migrations were preserved.");
          }
          continue;
        }
        const previous = originalChanges.get(file.path);
        if (!previous || previous.action === "delete" || file.action !== previous.action) {
          throw new Error("Migration repair changed a file outside the original request. No files were saved.");
        }
      }
      const candidate = new Map(
        generated.filter(file => !migrationPath.test(file.path)).map(file => [file.path, file]),
      );
      for (const file of corrections) candidate.set(file.path, file);
      const corrected = [...candidate.values()];
      validateWorkspaceSource(mergeSource(existing, corrected));
      return corrected;
    }
    // Migration-policy errors get their own strict repair path; other validation
    // failures are repairable only when required source files are missing.
    if (!(error instanceof Error) ||
        !/^(Full-stack source is missing |Add a SQL migration in migrations\/\.$)/.test(error.message)) throw error;
    const paths = new Set(source.map(file => file.path));
    const missing = ["public/index.html", "server.mjs", "package.json", "README.md", ".env.example"]
      .filter(path => !paths.has(path));
    if (!source.some(file => /^migrations\/[a-zA-Z0-9_-]+\.sql$/.test(file.path))) {
      missing.push("migrations/001_initial.sql");
    }
    // Do not undo an explicit deletion or rewrite an existing migration.
    if (generated.some(file => file.action === "delete" &&
        (missing.includes(file.path) ||
         (missing.includes("migrations/001_initial.sql") && file.path.startsWith("migrations/"))))) throw error;

    const requested = new Set(missing);
    const additions = await repair(missing, source);
    const normalizedAdditions = additions.map(file => ({
      ...file,
      path: file.path.replace(/^(?:\.\/)+/, ""),
    }));
    // Never allow a repair response to modify an existing path, even if that
    // path is outside the requested set and would otherwise be filtered out.
    if (normalizedAdditions.some(file =>
      file.action !== "create" || source.some(current => current.path === file.path) && !requested.has(file.path))) {
      throw new Error("ERA could not complete the missing full-stack files safely. No files were saved. Please retry.");
    }
    const normalized = normalizedAdditions.filter(file => requested.has(file.path));
    const addedPaths = new Set(normalized.map(file => file.path));
    if (normalized.length !== missing.length || addedPaths.size !== missing.length ||
        missing.some(path => !addedPaths.has(path)) ||
        normalized.some(file => file.action !== "create")) {
      throw new Error("ERA could not complete the missing full-stack files safely. No files were saved. Please retry.");
    }
    const completed = [...generated, ...normalized];
    validateWorkspaceSource(mergeSource(existing, completed));
    return completed;
  }
}
