import { Daytona, type Sandbox } from "@daytona/sdk";
import pg from "pg";
import { randomBytes, createHash } from "node:crypto";
import { RUNTIME_LIMITS, validateMigration } from "./workspace-policy";

let runtimeClient: Daytona | undefined;
export function daytona() {
  return runtimeClient ??= new Daytona({ apiKey: process.env.DAYTONA_API_KEY, target: "eu", requestTimeoutMs: 25_000 });
}
export async function isPrivateProviderPreview(value:string,sandbox:Sandbox):Promise<boolean>{
  // Provider proxy domains can differ by account/region. Its authenticated API
  // returns the URL; validate against the official public proxy template rather
  // than a hostname copied from a documentation example.
  // The global /api/config proxy template is NOT region-specific. Obtain this
  // sandbox's actual private proxy origin. Its broad token stays server-side.
  const template=new URL((await sandbox.getPreviewLink(3000)).url);
  const suffix=template.hostname.split(".").slice(1).join(".");
  if(template.protocol!=="https:"||!suffix.includes("."))return false;
  const url=new URL(value);
  return url.protocol==="https:"&&!url.username&&!url.password&&(!url.port||url.port==="443")&&url.hostname.endsWith("."+suffix);
}
export async function neon(path: string, method = "GET", body?: unknown): Promise<any> {
  const response = await fetch("https://console.neon.tech/api/v2" + path, {
    method, headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25_000),
  });
  if (response.status === 404 && method === "DELETE") return {};
  if (!response.ok) throw new Error(`Neon returned HTTP ${response.status}. Check the free account's allowance and API permissions; no paid upgrade was requested.`);
  return response.status === 204 ? {} : response.json();
}
export async function freeNeonOrganization(): Promise<string> {
  const result = await neon("/users/me/organizations");
  const org = result.organizations?.find((o: any) => o.plan === "free");
  if (!org) throw new Error("A verified Neon Free organization is required. Paid organizations are not provisioned.");
  return org.id;
}
export type RuntimeCredentials = { ownerUrl: string; runtimeUrl: string };
export async function createDatabase(projectId: string): Promise<{ id: string }> {
  const orgId = await freeNeonOrganization();
  const name = `era-workspace-${projectId}`;
  const listed = await neon(`/projects?org_id=${encodeURIComponent(orgId)}`);
  const existing = listed.projects?.find((p: any) => p.name === name);
  if (existing) return { id: existing.id };
  const result = await neon("/projects", "POST", { project: {
    org_id: orgId, name, region_id: "aws-eu-central-1", pg_version: 17,
    branch: { database_name: "era", role_name: "era_owner" },
    default_endpoint_settings: { autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.25 },
    settings: { quota: { compute_time_seconds: 3600, active_time_seconds: 14400,
      logical_size_bytes: 50_000_000, data_transfer_bytes: 100_000_000, written_data_bytes: 100_000_000 } },
  } });
  return { id: result.project.id };
}
export async function databaseCredentials(id: string): Promise<RuntimeCredentials> {
  const result = await neon(`/projects/${encodeURIComponent(id)}/connection_uri?database_name=era&role_name=era_owner&pooled=false`);
  const owner = new URL(result.uri);
  owner.searchParams.set("sslmode", "verify-full");
  const runtime = new URL(owner);
  runtime.username = "era_runtime";
  runtime.password = randomBytes(24).toString("hex");
  const credentials = { ownerUrl: owner.toString(), runtimeUrl: runtime.toString() };
  const client = new pg.Client({ connectionString: credentials.ownerUrl, connectionTimeoutMillis: 15_000, statement_timeout: 5000 });
  await client.connect();
  try {
    await client.query(`DO $$ BEGIN CREATE ROLE era_runtime LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    // This value is generated hexadecimal, not AI/user input.
    await client.query(`ALTER ROLE era_runtime PASSWORD '${runtime.password}' NOCREATEDB NOCREATEROLE NOINHERIT`);
    await client.query(`ALTER ROLE era_runtime SET statement_timeout = '5s'`);
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query("GRANT USAGE ON SCHEMA public TO era_runtime");
    await client.query("GRANT CONNECT ON DATABASE era TO era_runtime");
  } finally { await client.end(); }
  return credentials;
}
export async function migrateDatabase(credentials: RuntimeCredentials, files: {path:string;content:string}[]): Promise<void> {
  const migrations = files.filter(f=>/^migrations\/[a-zA-Z0-9_-]+\.sql$/.test(f.path)).sort((a,b)=>a.path.localeCompare(b.path));
  for (const migration of migrations) validateMigration(migration.content);
  const client = new pg.Client({ connectionString: credentials.ownerUrl, connectionTimeoutMillis: 15_000, statement_timeout: 5000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("CREATE TABLE IF NOT EXISTS _era_migrations (path text PRIMARY KEY, hash text NOT NULL)");
    for (const file of migrations) {
      const hash = createHash("sha256").update(file.content).digest("hex");
      const old = await client.query("SELECT hash FROM _era_migrations WHERE path=$1", [file.path]);
      if (old.rowCount) {
        if (old.rows[0].hash !== hash) throw new Error(`Migration ${file.path} already ran. Keep it unchanged and add a new numbered migration. Your database has not been reset.`);
        continue;
      }
      await client.query(file.content);
      await client.query("INSERT INTO _era_migrations(path,hash) VALUES($1,$2)",[file.path,hash]);
    }
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_era_migrations'");
    for (const {tablename} of tables.rows) {
      const identifier = '"' + String(tablename).replace(/"/g,'""') + '"';
      await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.${identifier} TO era_runtime`);
    }
    await client.query("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO era_runtime");
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { await client.end(); }
}
export async function createSandbox(projectId: string): Promise<Sandbox> {
  const client = daytona();
  try { return await client.get(`era-${projectId}`); } catch { /* stable name makes uncertain creation recoverable */ }
  return client.create({
    name: `era-${projectId}`, image: "node:22-bookworm-slim", language: "javascript",
    resources: { cpu: RUNTIME_LIMITS.cpu, memory: RUNTIME_LIMITS.memory, disk: RUNTIME_LIMITS.disk },
    public: false, autoStopInterval: 5, autoArchiveInterval: 5, autoDeleteInterval: -1,
    labels: { application: "era", project: projectId },
    // No ERA environment variables or organization secrets are mounted.
    envVars: { NODE_ENV: "production" },
  }, { timeout: 120 });
}
async function reusableBuildDirectory(sandbox: Sandbox, revision: string): Promise<string | null> {
  const prefix = revision.slice(0, 16);
  const result = await sandbox.process.executeCommand(
    `find / -maxdepth 1 -type d -name 'era-build-${prefix}-*' -print`,
    undefined, undefined, 10,
  );
  if (result.exitCode !== 0) return null;
  const candidatePattern = new RegExp(`^/era-build-${prefix}-[a-f0-9]{16}$`);
  for (const candidate of (result.result ?? "").split(/\r?\n/).map(path => path.trim())) {
    if (!candidatePattern.test(candidate)) continue;
    const check = await sandbox.process.executeCommand(
      `if [ -d '${candidate}' ] && [ ! -L '${candidate}' ] && [ -f '${candidate}/server.mjs' ] && [ -z "$(find '${candidate}' -type l -print -quit)" ]; then echo reusable; fi`,
      undefined, undefined, 10,
    );
    if (check.exitCode === 0 && check.result?.includes("reusable")) return candidate;
  }
  return null;
}

async function startRuntime(sandbox: Sandbox, dir: string, credentials: RuntimeCredentials,
  log: (s: string) => Promise<void>): Promise<void> {
  const started = await sandbox.process.executeCommand(
    `nohup timeout --kill-after=5s 600s node server.mjs > /tmp/era-runtime.log 2>&1 < /dev/null &`,
    dir, { PORT:"3000", DATABASE_URL:credentials.runtimeUrl, NODE_OPTIONS:"--max-old-space-size=384" }, 10);
  if (started.exitCode !== 0) throw new Error("Application could not be started.");
  const health = await sandbox.process.executeCommand(
    `node -e 'let n=0;const t=setInterval(async()=>{try{const r=await fetch("http://127.0.0.1:3000/healthz",{signal:AbortSignal.timeout(1500)});if(r.ok){clearInterval(t);process.exit(0)}console.log("Backend health HTTP",r.status)}catch(e){if(n===18)console.log("Backend probe",e.message)}if(++n===20){clearInterval(t);process.exit(1)}},500)'`,
    undefined, undefined, 15);
  if (health.exitCode !== 0) {
    await log(health.result ?? "");
    const diagnostic=await sandbox.process.executeCommand(
      `node --input-type=module -e 'import {neon} from "@neondatabase/serverless";try{await neon(process.env.DATABASE_URL).query("SELECT 1",[],{fetchOptions:{signal:AbortSignal.timeout(5000)}});console.log("Project database HTTPS connection: OK")}catch(e){console.log("Project database HTTPS connection:",e.code,e.message)}'`,
      dir,{DATABASE_URL:credentials.runtimeUrl},10);
    await log(diagnostic.result ?? "");
    const logs=await sandbox.process.executeCommand("tail -c 12000 /tmp/era-runtime.log",undefined,undefined,5);
    await log(logs.result ?? "");
    throw new Error("Backend health check failed. Check server.mjs, PORT and /healthz in the runtime logs.");
  }
}

export async function buildSandbox(sandbox: Sandbox, credentials: RuntimeCredentials,
  files: {path:string;content:string}[], revision: string, log: (s:string)=>Promise<void>,
  resumeIfUnchanged = false): Promise<boolean> {
  await sandbox.refreshData();
  if(sandbox.state==="started") await sandbox.stop(60);
  await sandbox.start(90);
  if (resumeIfUnchanged) {
    const existingDir = await reusableBuildDirectory(sandbox, revision);
    if (existingDir) {
      await startRuntime(sandbox, existingDir, credentials, log);
      return true;
    }
    await log("Saved build directory is unavailable or unsafe; preparing a fresh clean build.");
  }

  // Remove stale builds after stopping old processes so repeated revisions do
  // not fill the trial sandbox's small disk.
  const cleanup = await sandbox.process.executeCommand(
    "find / -maxdepth 1 -mindepth 1 -type d -name 'era-build-*' -exec rm -rf -- {} +",
    undefined, undefined, 15,
  );
  if (cleanup.exitCode !== 0) throw new Error("Could not remove stale runtime build directories.");
  // Never reuse a directory the previous untrusted revision could have replaced
  // with symlinks. Old processes are stopped before choosing this random path.
  const dir = `/era-build-${revision.slice(0,16)}-${randomBytes(8).toString("hex")}`;
  const mkdir=await sandbox.process.executeCommand(`mkdir -m 755 -- ${dir}`, undefined, undefined, 10);
  if(mkdir.exitCode!==0)throw new Error("Could not create a clean source directory.");
  const directories = new Set(files.map(f=>f.path.split("/").slice(0,-1).join("/")).filter(Boolean));
  for (const path of directories) await sandbox.fs.createFolder(`${dir}/${path}`, "755");
  await sandbox.fs.uploadFiles(files.map(file=>({source:Buffer.from(file.content),destination:`${dir}/${file.path}`})));
  // Scripts are ignored and user-supplied install/start scripts are never run.
  const install = await sandbox.process.executeCommand("npm install --ignore-scripts --omit=dev --no-audit --no-fund --package-lock=false", dir,
    { NODE_OPTIONS: "--max-old-space-size=384" }, 90);
  await log(install.result ?? "");
  if (install.exitCode !== 0) throw new Error("Dependency installation failed. See sanitized build logs.");
  await log("Applying additive database migrations (existing records are preserved).");
  await migrateDatabase(credentials, files);
  await startRuntime(sandbox, dir, credentials, log);
  return false;
}
