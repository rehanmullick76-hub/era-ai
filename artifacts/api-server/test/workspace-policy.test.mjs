import test from "node:test";
import assert from "node:assert/strict";
import { safeWorkspacePath, validateMigration, encryptRuntimeCredentials, decryptRuntimeCredentials, redactRuntimeLog, sourceRevision, validateWorkspaceSource, runtimeBudgetLimitCents, runtimeBudgetWindowId, canReserveRuntimeBudget } from "../src/lib/workspace-policy.ts";

test("shared free-trial reservation cap is $5 and cannot exceed that ceiling",()=>{
  assert.equal(runtimeBudgetLimitCents(undefined),500);
  assert.equal(runtimeBudgetLimitCents("5"),500);
  assert.equal(runtimeBudgetLimitCents("1"),100);
  assert.equal(runtimeBudgetLimitCents("10"),500);
  assert.ok(Number.isNaN(runtimeBudgetLimitCents("invalid")));
  assert.equal(canReserveRuntimeBudget(100,5,500),true);
  assert.equal(canReserveRuntimeBudget(500,5,500),false);
  assert.equal(canReserveRuntimeBudget(100,0,100),true);
});
test("shared runtime reservation window rolls over daily in UTC",()=>{
  assert.equal(runtimeBudgetWindowId(new Date("2026-10-28T23:59:59.000Z")),"free-trial-2026-10-28");
  assert.equal(runtimeBudgetWindowId(new Date("2026-10-29T00:00:00.000Z")),"free-trial-2026-10-29");
});

test("workspace paths exclude traversal, absolute, shell and reserved data paths",()=>{
  for(const p of ["../server.mjs","/tmp/index.html","public/../../.env","public//x.js","public/a;id.js","node_modules/a.js",".env",".env.production","data/records.json","foo\\bar.js"])assert.equal(safeWorkspacePath(p),false,p);
  for(const p of ["public/index.html","migrations/001_initial.sql",".env.example","server.mjs"])assert.equal(safeWorkspacePath(p),true,p);
});
test("full-stack source preflights additive migrations before provisioning",()=>{
  const files=[
    {path:"public/index.html",content:"<!doctype html>"},
    {path:"server.mjs",content:""},
    {path:"package.json",content:JSON.stringify({type:"module",dependencies:{express:"5.2.1","@neondatabase/serverless":"1.0.2"}})},
    {path:"README.md",content:"Setup"},
    {path:".env.example",content:"PORT=3000"},
    {path:"migrations/001_initial.sql",content:"CREATE TABLE IF NOT EXISTS courses(id serial PRIMARY KEY); CREATE TABLE IF NOT EXISTS enrollments(id serial PRIMARY KEY, course_id int REFERENCES courses(id) ON DELETE SET NULL);"},
  ];
  assert.doesNotThrow(()=>validateWorkspaceSource(files));
  assert.throws(()=>validateWorkspaceSource(files.map(f=>f.path.startsWith("migrations/")
    ?{...f,content:"DELETE FROM courses;"}:f),),/Unsafe migration/);
});
test("migrations accept additive DDL but reject destructive/procedural SQL",()=>{
  validateMigration("CREATE TABLE IF NOT EXISTS notes(id serial PRIMARY KEY, title text NOT NULL);");
  validateMigration("ALTER TABLE notes ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;");
  validateMigration("CREATE TABLE IF NOT EXISTS courses(id serial PRIMARY KEY); CREATE TABLE IF NOT EXISTS enrollments(id serial PRIMARY KEY, course_id int REFERENCES courses(id) ON DELETE SET NULL);");
  validateMigration("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS course_id int REFERENCES courses(id) ON DELETE SET NULL;");
  for(const sql of ["DROP TABLE notes;","TRUNCATE notes;","DELETE FROM notes;","DO $$ BEGIN END $$;","CREATE FUNCTION foo() RETURNS void;","CREATE TABLE IF NOT EXISTS x(id int); SELECT 1;","COPY x FROM PROGRAM 'id';","GRANT ALL ON SCHEMA public TO PUBLIC;"])
    assert.throws(()=>validateMigration(sql),undefined,sql);
  assert.throws(()=>validateMigration("INSERT INTO products(name) VALUES ('Demo');"),/demo\/sample records.*app or API.*Existing data was preserved/);
  assert.throws(()=>validateMigration("CREATE TABLE IF NOT EXISTS enrollments(id int REFERENCES courses(id) ON DELETE CASCADE);"));
  for(const sql of [
    "CREATE TABLE IF NOT EXISTS leaked AS SELECT * FROM pg_roles;",
    "CREATE TABLE IF NOT EXISTS leaked AS SELECT * FROM _era_migrations;",
    "ALTER TABLE _era_migrations ADD COLUMN x int;",
    "ALTER TABLE notes ADD COLUMN x int, RENAME TO changed;",
    "CREATE INDEX IF NOT EXISTS delayed ON notes (pg_sleep(10));",
    "CREATE TABLE IF NOT EXISTS notes (setting text DEFAULT current_setting('search_path'));",
    "CREATE TABLE IF NOT EXISTS notes (value text DEFAULT lo_get(1));",
    "ALTER TABLE notes SET SCHEMA public;",
    "CREATE VIEW IF NOT EXISTS exposed AS SELECT 1;",
  ]) assert.throws(()=>validateMigration(sql),undefined,sql);
});
test("project credential encryption authenticates ciphertext",()=>{
  process.env.SESSION_SECRET??="unit-test-only-key-not-for-real-credentials";
  const sealed=encryptRuntimeCredentials({ownerUrl:"postgresql://owner:secret@db/app"});
  assert.ok(!sealed.includes("secret"));assert.deepEqual(decryptRuntimeCredentials(sealed),{ownerUrl:"postgresql://owner:secret@db/app"});
  const data=Buffer.from(sealed,"base64");data[20]^=1;
  assert.throws(()=>decryptRuntimeCredentials(data.toString("base64")));
});
test("runtime logs redact credentials and are bounded",()=>{
  const log=redactRuntimeLog("postgresql://foo:bar@host/db Bearer abc token=xyz my-private-value",["my-private-value"]);
  for(const s of ["foo:bar","abc","xyz","my-private-value"])assert.ok(!log.includes(s));
  assert.equal(redactRuntimeLog("x".repeat(20_000)).length,16000);
  assert.ok(!redactRuntimeLog('{"token":"json-private-token","password":"json-password"}').includes("json-private-token"));
});
test("source revisions are deterministic and detect edits",()=>{
  const a={path:"a",content:"one"},b={path:"b",content:"two"};
  assert.equal(sourceRevision([a,b]),sourceRevision([b,a]));
  assert.notEqual(sourceRevision([a]),sourceRevision([{...a,content:"changed"}]));
});
test("static mocks cannot be deployed as full-stack projects",()=>{
  assert.throws(()=>validateWorkspaceSource([{path:"index.html",content:"Hi"}]),/public\/index.html/);
});
