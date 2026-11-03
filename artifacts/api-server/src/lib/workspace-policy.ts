import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const RUNTIME_LIMITS = { cpu: 1, memory: 1, disk: 3, minutes: 10, maxFiles: 100, maxBytes: 1_000_000 };
export const MAX_SHARED_RUNTIME_BUDGET_CENTS = 500;
export function runtimeBudgetLimitCents(configuredUsd: string | undefined): number {
  const configured = Number(configuredUsd ?? 5);
  return Number.isFinite(configured)
    ? Math.min(MAX_SHARED_RUNTIME_BUDGET_CENTS, Math.floor(configured * 100))
    : Number.NaN;
}
export function canReserveRuntimeBudget(reservedCents: number, reserveCents: number, maxCents: number): boolean {
  return Number.isFinite(maxCents) && reservedCents >= 0 && reserveCents >= 0 &&
    reservedCents + reserveCents <= maxCents;
}
export function runtimeBudgetWindowId(date = new Date()): string {
  return `free-trial-${date.toISOString().slice(0, 10)}`;
}
export function safeWorkspacePath(path: string): boolean {
  return path.length < 180 && /^[a-zA-Z0-9_.\-/]+$/.test(path) &&
    !path.startsWith("/") && !path.split("/").some(p => !p || p === "." || p === ".." ||
      ["node_modules", ".git", "data", ".era", "dist"].includes(p)) &&
    !/(^|\/)\.env(?:$|\.(?!example$))/.test(path);
}
export function sourceRevision(files: { path: string; content: string }[]): string {
  return createHash("sha256").update(JSON.stringify([...files].sort((a,b) => a.path.localeCompare(b.path)))).digest("hex");
}
export function redactRuntimeLog(text: string, secrets: string[] = []): string {
  let result = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (const value of secrets.filter(Boolean).sort((a,b)=>b.length-a.length)) result = result.split(value).join("[redacted]");
  return result.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[database URL redacted]")
    .replace(/(?:Bearer\s+)[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(["']?(?:password|secret|api[_-]?key|token)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[redacted]")
    .slice(-16_000);
}
function credentialKey() {
  if (!process.env.SESSION_SECRET) throw new Error("Workspace encryption is not configured.");
  return createHash("sha256").update("era-workspace-credentials-v1:" + process.env.SESSION_SECRET).digest();
}
export function encryptRuntimeCredentials(value: unknown): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
export function decryptRuntimeCredentials<T>(value: string): T {
  const data = Buffer.from(value, "base64"), decipher = createDecipheriv("aes-256-gcm", credentialKey(), data.subarray(0,12));
  decipher.setAuthTag(data.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(12,-16)), decipher.final()]).toString());
}
export function validateWorkspaceSource(files: { path: string; content: string }[]): void {
  if (!files.length || files.length > RUNTIME_LIMITS.maxFiles ||
      files.reduce((n,f)=>n+Buffer.byteLength(f.content),0)>RUNTIME_LIMITS.maxBytes)
    throw new Error("Workspace source must contain 1–100 files and fit within 1 MB.");
  if (files.some(f=>!safeWorkspacePath(f.path))) throw new Error("Unsafe or reserved file path in workspace source.");
  for (const path of ["public/index.html", "server.mjs", "package.json", "README.md", ".env.example"])
    if (!files.some(f=>f.path===path)) throw new Error(`Full-stack source is missing ${path}.`);
  const migrations = files.filter(f=>/^migrations\/[a-zA-Z0-9_-]+\.sql$/.test(f.path));
  if (!migrations.length) throw new Error("Add a SQL migration in migrations/.");
  for (const migration of migrations) validateMigration(migration.content);
  const pkg = JSON.parse(files.find(f=>f.path==="package.json")!.content);
  if (pkg.type!=="module" || Object.keys(pkg.dependencies??{}).some(n=>!["express","@neondatabase/serverless"].includes(n)) ||
      Object.values(pkg.dependencies??{}).some(v=>typeof v!=="string"||!/^[~^]?\d+\.\d+\.\d+$/.test(v)))
    throw new Error("Trial projects support ES modules and versioned express/@neondatabase/serverless dependencies only.");
  if (!pkg.dependencies?.express || !pkg.dependencies?.["@neondatabase/serverless"]) throw new Error("Include express and @neondatabase/serverless dependencies. Use Neon HTTPS SQL, not blocked PostgreSQL TCP.");
  if(pkg.overrides||pkg.resolutions||pkg.workspaces||files.some(f=>/(?:^|\/)\.npmrc$/.test(f.path)))
    throw new Error("Custom package registries, dependency overrides and nested workspaces are not supported in trial projects.");
}
export function validateMigration(sql: string): void {
  // Deliberately narrow first-version migration grammar. Reject procedural or
  // destructive SQL rather than trying to infer that arbitrary SQL is safe.
  const clean = sql.replace(/--[^\n]*/g, "").trim();
  // ON DELETE SET NULL only clears an optional foreign-key reference; it
  // preserves the dependent row. It is valid additive DDL, not DELETE DML.
  const dmlChecked = clean.replace(/\bON\s+DELETE\s+SET\s+NULL\b/gi, "");
  if (/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(dmlChecked))
    throw new Error("Unsafe migration: trial migrations allow additive schema changes only. Add demo/sample records through the app or API, not migration SQL. Existing data was preserved.");
  if (/\/\*|\$|\\|\b(?:DROP|EXECUTE|DO|FUNCTION|PROCEDURE|COPY|GRANT|REVOKE)\b/i.test(dmlChecked))
    throw new Error("Unsafe migration: trial migrations allow additive schema changes only. Existing data was not reset.");
  const statements = clean.split(";").map(s=>s.trim()).filter(Boolean);
  const privilegedOrUnsafe = /\b(?:_era_migrations|pg_\w*|information_schema|current_setting|set_config|pg_sleep|lo_\w*|dblink|RENAME|OWNER|DISABLE|TRIGGER|RULE|VIEW|MATERIALIZED|PARTITION|INHERITS)\b|\bSET\s+SCHEMA\b|\bAS\s+SELECT\b/i;
  if (privilegedOrUnsafe.test(dmlChecked))
    throw new Error("Unsafe migration: trial migrations allow additive schema changes only. Existing data was not reset.");
  if (!statements.length || statements.some(s=>
    !/^CREATE\s+(?:TABLE\s+IF\s+NOT\s+EXISTS|(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS)\b|^ALTER\s+TABLE\s+[a-zA-Z_][a-zA-Z0-9_]*\s+ADD\s+COLUMN\b/i.test(s) ||
    (/^ALTER\s+TABLE\b/i.test(s) && s.includes(","))))
    throw new Error("Unsupported migration. Use CREATE TABLE/INDEX IF NOT EXISTS or ALTER TABLE ADD COLUMN.");
}
