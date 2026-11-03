const BLOCKED_SEGMENTS = new Set(["node_modules", "data", ".data", "db", ".git", "pgdata", "postgres", "sqlite", ".secrets", "secrets"]);
const BLOCKED_NAME = /(^\.env(\..*)?$)|(\.(sql|dump|db|sqlite3?|pem|key|p12|pfx|log)$)|(credential|secret|id_rsa|\.npmrc$)/i;

/** Returns a safe normalized path, or null when the file must not be exported. */
export function safeExportPath(raw: string): string | null {
  if (!raw || raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return null;
  const parts = raw.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  if (parts.slice(0, -1).some((p) => BLOCKED_SEGMENTS.has(p.toLowerCase()))) return null;
  const name = parts[parts.length - 1];
  if (name === ".env.example") return raw;
  // SQL source migrations belong in the export; arbitrary SQL dumps do not.
  if (/^migrations\/[a-zA-Z0-9_-]+\.sql$/.test(raw) && !/dump|backup/i.test(name)) return raw;
  if (BLOCKED_NAME.test(name)) return null;
  return raw;
}

export const ENV_EXAMPLE = `# Placeholders only. Replace with your own values.
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
SESSION_SECRET=replace-with-a-long-random-string
PORT=3000
`;

export function buildSetupReadme(projectName: string): string {
  return `# ${projectName} - full-stack export

This archive contains the source code only. No runtime data, database
contents, database dumps, credentials or .env files are included.

## Setup
1. Copy .env.example to .env and fill in your own values.
2. Provision your own private Neon PostgreSQL database and set DATABASE_URL. The backend uses Neon's HTTPS SQL driver, because the free preview runtime restricts direct PostgreSQL TCP connections.
3. Install dependencies. Apply migrations in filename order using psql from a machine with PostgreSQL TCP access: psql "$DATABASE_URL" -f migrations/001_initial.sql. Never put the live database URL in exported source or browser code.
4. With Node.js 22+, run node --env-file=.env server.mjs (or a start script that loads .env), then open http://localhost:3000.

## ERA free-trial preview limits
- A preview runtime runs for at most 10 minutes and is suspended after 5 minutes of idle time.
- Each user and the platform overall have a cap on trial workspace provisioning.
- Deleting a workspace in ERA removes its runtime and database but keeps this source.
`;
}

export function collectExportFiles(files: { path: string; content: string }[], projectName: string) {
  const out: { path: string; content: string }[] = [];
  for (const f of files) {
    const p = safeExportPath(f.path);
    if (!p || p === ".env.example" || p === "SETUP.md") continue;
    out.push({ path: p, content: f.content });
  }
  out.push({ path: ".env.example", content: ENV_EXAMPLE });
  out.push({ path: "SETUP.md", content: buildSetupReadme(projectName) });
  return out;
}
